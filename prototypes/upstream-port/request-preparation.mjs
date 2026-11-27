// Public boundary for the sidebar's editable request consumer. A source
// snapshot is an observation, never proof of host loading or an approval.
export function invokedSkillNames(text, knownNames) {
  return [...new Set([...String(text || '').matchAll(/(?:^|\s)[$/]([a-z][a-z0-9-]*)(?![A-Za-z0-9_./\\-])/g)]
    .map(match => match[1]).filter(name => knownNames.includes(name)))];
}

let requestServiceSequence = 0;

export function createRequestPreparation({ knownNames, prepareSkill, readSkillDoc }) {
  const namespace='request-service-'+(++requestServiceSequence)+'-';
  const drafts = new Map();
  let sequence = 0;
  let disposed = false;
  async function observe(names) {
    const facts = [], notices = [], blockingReasons = [];
    let dependenciesAllowed = true;
    for (const name of names) {
      if(disposed)throw new Error('request-preparation-disposed');
      let update, doc;
      try { update = await prepareSkill(name); }
      catch { update = { status: 'prepare-failed', bindings: [] }; }
      if(disposed)throw new Error('request-preparation-disposed');
      try { doc = await readSkillDoc(name); }
      catch { doc = { ok: false, missing: true }; }
      if(disposed)throw new Error('request-preparation-disposed');
      const source = doc?.source || {};
      const execution = doc?.execution || { allowed: false, reasons: ['必要工具和资料尚未核验。'] };
      const checked = update?.status === 'checked';
      const bindings = (update?.bindings || []).map(binding => ({
        sourceId: binding.sourceId || null,
        revision: binding.revision || null,
        status: binding.latest === true && ['updated','up-to-date'].includes(binding.status) ? 'verified-version' : binding.status,
        latest: binding.latest === true,
        usable: binding.usable === true,
        errorKind: binding.errorKind || null,
      })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const allowed = doc?.ok === true && execution.allowed === true;
      dependenciesAllowed &&= allowed;
      if (!allowed) {
        const reasons = Array.isArray(execution.reasons) ? execution.reasons.filter(reason => typeof reason === 'string' && reason.trim()) : [];
        blockingReasons.push(...(reasons.length ? reasons : ['请查证并补齐该技能的来源、必要工具及资料。']).map(reason => name + '：' + reason));
      }
      // Check timestamps and byte counters do not change behavior. The document
      // body is compared locally; it is never inserted into the user request.
      facts.push({name,available:doc?.ok === true,path:doc?.path || source.path || null,
        kind:source.kind || 'unknown',actualLoad:'unknown',hostResolution:source.hostResolution || 'unknown',
        sourceId:source.sourceId || null,difference:source.difference?.kind || 'unknown',
        body:String(doc?.md || '').replace(/\r\n/g,'\n').trim(),execution:{allowed,mode:execution.mode || '',reasons:execution.reasons || [],files:execution.files || [],documentDigests:execution.documentDigests || []},
        update:{status:update?.status || 'unknown',latest:update?.latest === true,bindings}});
      let notice = '技能 '+name+'：'+(source.kind === 'host-resolved' ? '当前项目宿主解析规则' : source.kind === 'bundled-reference' ? '随包参考规则' : '来源未核验')+
        '；路径：'+(doc?.path || source.path || '未提供')+'；实际加载：未核验。';
      if (source.kind === 'bundled-reference')notice += allowed ? ' 完整规则及必要条件已核验，可作只读备用；这不代表宿主加载。' : ' 参考正文可读不等于完整备用可用。';
      notice += checked ? ' 更新：已核验当前绑定版本。' : update?.status === 'source-unbound' ? ' 更新：来源未绑定，不能声称最新。' : ' 更新：未通过或无法核验（'+String(update?.status || 'unknown')+'），保留现有可用版本，不声称最新。';
      if (!allowed)notice += ' 必要条件未满足：'+(execution.reasons || ['请查证来源、工具及资料。']).join('；')+'；本请求先查证补齐，暂停依赖实施，保留用户明确规则。';
      if (source.difference?.kind === 'review-behavior')notice += ' 同名正文存在差异：按目标和用户明确规则判断；兼容差异自主处理，实质冲突才澄清。';
      notices.push(notice);
    }
    return { facts, sourceNote:notices.join('\n'), dependenciesAllowed, blockingReasons };
  }
  function remember(baseText, names, observation) {
    const id = namespace+(++sequence);
    const candidateText = baseText+(observation.sourceNote ? '\n\n'+observation.sourceNote : '');
    const draft = Object.freeze({id,text:candidateText,sourceNote:observation.sourceNote,names:Object.freeze([...names]),
      dependenciesAllowed:observation.dependenciesAllowed,blockingReasons:Object.freeze([...observation.blockingReasons]),mode:observation.dependenciesAllowed?'request':'clarify'});
    drafts.set(id,{draft,signature:JSON.stringify(observation.facts)});
    // Session-only observations; callers hold their editable text independently.
    while(drafts.size>100)drafts.delete(drafts.keys().next().value);
    return draft;
  }
  return {
    dispose() { disposed=true;drafts.clear(); },
    async prepare({text}) {
      if(disposed)throw new Error('request-preparation-disposed');
      const baseText=String(text || '');
      const names=invokedSkillNames(baseText,knownNames);
      return remember(baseText,names,await observe(names));
    },
    async check({draftId,text}) {
      const finalText=String(text || '');
      const current=drafts.get(draftId);
      if(!current)return {allowed:false,status:'review-required',text:finalText,reason:'来源快照已失效，请重新准备并审阅。'};
      const names=invokedSkillNames(finalText,knownNames);
      const observation=await observe(names);
      if(disposed)return {allowed:false,status:'review-required',text:finalText,reason:'项目面板已关闭，请重新定位目标。'};
      if(JSON.stringify(names)!==JSON.stringify(current.draft.names) || JSON.stringify(observation.facts)!==current.signature) {
        return {allowed:false,status:'review-required',text:finalText,sourceNote:observation.sourceNote,
          dependenciesAllowed:observation.dependenciesAllowed,blockingReasons:observation.blockingReasons,reason:'技能来源、必要条件或所选技能已变化；保留原文，先更新预览并重新审阅。'};
      }
      return {allowed:true,status:'unchanged',text:finalText,dependenciesAllowed:observation.dependenciesAllowed,blockingReasons:observation.blockingReasons};
    },
  };
}
