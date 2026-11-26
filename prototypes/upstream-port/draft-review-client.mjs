// UI consumer of the public requestPreparation boundary. Source resolution and
// snapshot comparison stay in the owning service, outside layout/state code.
export function createDraftReview({preparation,panel,editor,note,state,getGenerated,setGenerated,persist}) {
  let draftId=null, sourceNote=state.sourceNotice || '', generation=0, pending=Promise.resolve(false);
  const removeNote=(text,previous)=>{
    if(!previous)return text;
    const start=text.lastIndexOf(previous);
    return start<0?text:text.slice(0,start).trimEnd()+text.slice(start+previous.length);
  };
  const review={
    invalidate(){draftId=null;generation++;pending=Promise.resolve(false);},
    refresh(){
      const at=++generation;
      pending=(async()=>{
        if(!preparation){note.textContent='技能来源准备能力不可用；出口已停止。';return false;}
        const before=editor.value, baseline=getGenerated();
        note.setAttribute('data-source-state','checking');
        try{
          const candidate=await preparation.prepare({text:removeNote(before,sourceNote)});
          if(at!==generation || !panel.isConnected)return false;
          note.textContent=candidate.sourceNote || '最终请求未指定技能；不声称宿主加载。';
          if(editor.value!==before){note.textContent+=' 编辑已变化，请重新核验并审阅；出口已停止。';note.setAttribute('data-source-state','review-required');return false;}
          if(candidate.text!==before && before!==baseline && !window.confirm('技能来源状态已变化，更新已编辑的草稿预览？取消保留原文并停止出口。')){
            note.textContent+=' 来源变化尚未写入预览，请重新审阅；出口已停止。';note.setAttribute('data-source-state','review-required');return false;
          }
          const nextBaseline=before===baseline?candidate.text:removeNote(baseline,sourceNote)+(candidate.sourceNote?'\n\n'+candidate.sourceNote:'');
          editor.value=candidate.text;
          sourceNote=candidate.sourceNote || '';
          state.sourceNotice=sourceNote;
          setGenerated(nextBaseline);
          draftId=candidate.id;
          persist();
          note.setAttribute('data-source-state','ready');
          return true;
        }catch(error){
          if(at!==generation || !panel.isConnected)return false;
          note.textContent='来源核验失败：'+String(error.message || error)+'；草稿已保留，出口已停止。';note.setAttribute('data-source-state','review-required');return false;
        }
      })();
      return pending;
    },
    async validate(){
      await pending;
      if(!preparation || !panel.isConnected)return false;
      const before=editor.value;
      try{
        const result=await preparation.check({draftId,text:before});
        if(!panel.isConnected || editor.value!==before){note.textContent='草稿或目标已变化，请重新审阅；出口已停止。';return false;}
        if(result.allowed===true && result.status==='unchanged')return true;
        const accepted=await review.refresh();
        // Even unchanged display text cannot approve changed source facts.
        // A later explicit outlet click acknowledges the reviewed observation.
        if(!accepted)return false;
        note.textContent+=' 技能状态已变化，请审阅当前预览，再次选择出口。';
        return false;
      }catch(error){note.textContent='来源复核失败：'+String(error.message || error)+'；草稿已保留，出口已停止。';return false;}
    },
  };
  return review;
}
