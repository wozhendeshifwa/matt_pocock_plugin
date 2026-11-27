// Keep complete paths available inside the existing file-row layout. CSS
// cannot make a string shortened by the upstream model horizontally readable.
export function adaptVersionControlPaths(source) {
  const anchors = [
    ['pathText: vcMiddle(row.path, 46),', 'pathText: row.path,'],
    ["key: 'path', className: 'dsws-vc-mono', style: { display: 'block'", "key: 'path', className: 'dsws-vc-mono', 'data-vc-file-path': 1, style: { display: 'block'"],
    ["pathText: fold.state.path || '',", "pathText: String(identity.worktreePath || ''),"],
  ];
  for (const [before, after] of anchors) {
    if (source.split(before).length !== 2) throw new Error('Version-control path boundary changed: ' + before);
    source = source.replace(before, after);
  }
  return source;
}
