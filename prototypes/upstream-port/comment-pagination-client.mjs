// Adapt only comment rendering, leaving the pinned vendor and its state machine
// intact. A successful continuation must be visible, not just counted.
export function adaptCommentPagination(source) {
  for (const [before, after] of [
    ['commentsNodes.slice(0,50).map(', 'commentsNodes.map('],
    ['Math.min(50, commentsNodes.length)', 'commentsNodes.length'],
  ]) {
    if (source.split(before).length !== 2) throw new Error('Upstream comment renderer boundary changed: ' + before);
    source = source.replace(before, after);
  }
  return source;
}
