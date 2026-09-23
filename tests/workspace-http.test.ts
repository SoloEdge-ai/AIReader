import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createCore } from "../apps/core/src/server";

test("workspace survives restart without allowing cross-book or stale writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aireader-workspace-"));
  let core = createCore(directory, "dist/web");
  let origin = "",
    cookie = "";
  async function connect() {
    await new Promise<void>((done) => core.server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(core.server.address() as { port: number }).port}`;
    const response = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin },
    });
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  }
  function request(path: string, value?: unknown) {
    return fetch(origin + "/api/" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  }
  async function book(width: number) {
    const pdf = await PDFDocument.create();
    pdf.addPage([width, 700]);
    const response = await fetch(origin + "/api/books", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: Buffer.from(await pdf.save()),
    });
    const result = await response.json();
    await core.library.waitForBook(result.id);
    return result;
  }
  try {
    await connect();
    const first = await book(500),
      other = await book(400);
    const path = `books/${first.id}/workspace`;
    const initialResponse = await request(path);
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json();
    expect(initial).toMatchObject({
      bookId: first.id,
      revision: 0,
      cards: [],
      links: [],
    });
    const card = {
      id: "card-one",
      kind: "note",
      title: "Observation",
      text: "My interpretation",
      comment: "",
      x: 720,
      y: 40,
      width: 300,
      height: 240,
    };
    const excerpt = {
      ...card,
      id: "excerpt-one",
      kind: "excerpt",
      text: "Selected text",
      source: {
        fingerprint: first.fingerprint,
        anchors: [{ page: 1, rects: [[10, 20, 100, 40]] }],
      },
    };
    const draft = {
      ...initial,
      camera: { x: 520, y: 320, zoom: 1.25 },
      cards: [card, excerpt],
      links: [
        {
          id: "relation-one",
          from: card.id,
          to: excerpt.id,
          label: "supports",
        },
      ],
    };
    const savedResponse = await request(path, draft);
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.revision).toBe(1);
    expect((await request(path, draft)).status).toBe(400);
    expect(
      (
        await request(`books/${other.id}/workspace`, {
          ...draft,
          bookId: other.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(path, {
          ...saved,
          links: [{ ...saved.links[0], to: "absent" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(path, {
          ...saved,
          cards: [
            card,
            {
              ...excerpt,
              source: {
                ...excerpt.source,
                anchors: [{ page: 2, rects: [[10, 20, 100, 40]] }],
              },
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(path, {
          ...saved,
          cards: [card, { ...excerpt, text: "silently changed source" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(path, { ...saved, cards: [card, { ...excerpt, x: -10 }] }))
        .status,
    ).toBe(400);
    core.close();
    core = createCore(directory, "dist/web");
    await connect();
    expect(await (await request(path)).json()).toEqual(saved);
    const edited = await request(path, {
      ...saved,
      cards: [
        { ...card, text: "Revised", x: 950 },
        { ...excerpt, comment: "Personal interpretation" },
      ],
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).cards[0]).toMatchObject({
      text: "Revised",
      x: 950,
    });
    expect(
      (await (await request(`books/${other.id}/workspace`)).json()).cards,
    ).toEqual([]);
  } finally {
    core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
