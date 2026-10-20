import { useState } from "react";
import type { Inquiry } from "../../../../../packages/protocol/src/inquiry";
import { Popover } from "../../ui/Popover";
import { Icon } from "../../ui/Icon";

export function InquiryActions({ ids, claims, disabled, onPrepare }: {
  ids: string[];
  claims: { id: string; title: string }[];
  disabled?: boolean;
  onPrepare: (action: Inquiry["action"], claimId?: string) => void;
}) {
  const [claimId, setClaimId] = useState("");
  return <Popover label="问 AI" triggerLabel="问 AI" trigger={<><Icon name="chat" /><span>问 AI</span></>}
    className="session-menu inquiry-actions" width={240} disabled={disabled || !ids.length}>
    {(close) => <>
      <button onClick={() => { close(); onPrepare("explain"); }}>解释所选材料</button>
      <button disabled={ids.length < 2} onClick={() => { close(); onPrepare("compare"); }}>比较观点与条件</button>
      {claims.length > 0 && ids.length > 1 && <label>待检查的观点
        <select aria-label="待检查的观点" value={claims.some((item) => item.id === claimId) ? claimId : ""}
          onChange={(event) => setClaimId(event.target.value)}>
          <option value="">选择一篇笔记</option>
          {claims.map((claim) => <option key={claim.id} value={claim.id}>{claim.title}</option>)}
        </select>
      </label>}
      <button disabled={ids.length < 2 || !claims.some((claim) => claim.id === claimId)}
        onClick={() => { close(); onPrepare("check", claimId); }}>检查这条观点的依据</button>
      <button onClick={() => { close(); onPrepare("custom"); }}>自定义问题</button>
    </>}
  </Popover>;
}
