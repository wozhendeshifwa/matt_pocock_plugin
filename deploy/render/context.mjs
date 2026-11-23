import { AsyncLocalStorage } from 'node:async_hooks';

export const projectContext = new AsyncLocalStorage();

export async function resolveCloudProject() {
  const project = projectContext.getStore();
  if (!project) throw new Error('请先使用 deck_repository_select 选择 GitHub 仓库。');
  return {
    threadId: project.identity, cwd: project.root, projectRoot: project.root,
    projectId: project.repository, associated: true, source: 'github-selection',
    sourceConflict: false, message: null,
  };
}
