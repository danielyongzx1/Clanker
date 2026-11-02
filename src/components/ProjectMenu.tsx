import * as Haptics from '@/lib/haptics';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { stopStreaming } from '@/lib/chat';
import { deleteProject } from '@/lib/projects';
import { useChats } from '@/store/chats';
import { useProjects, type Project } from '@/store/projects';
import { ContextMenu, type MenuAnchor, type MenuItem } from './ContextMenu';
import { confirm } from './Dialogs';

/**
 * Shows a chat in a project (null: a new one) over the project's page, so its back button leads
 * there. `onPage`: the project's page is the screen on top already.
 */
export function openProjectChat(projectId: string, chatId: string | null, onPage = false) {
  if (!onPage) router.push({ pathname: '/projects/[id]', params: { id: projectId } });
  router.push({ pathname: '/projects/chat', params: { project: projectId, ...(chatId ? { chat: chatId } : {}) } });
}

export function confirmDeleteProject(project: Project, onDeleted?: () => void) {
  const count = Object.values(useChats.getState().conversations).filter((c) => c.projectId === project.id).length;
  confirm({
    title: `Delete "${project.name}"?`,
    message: `This deletes the project${count ? `, its ${count} chat${count === 1 ? '' : 's'}` : ''}, its sources and files, and any memories only it could see. This can't be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => {
      for (const c of Object.values(useChats.getState().conversations)) if (c.projectId === project.id) stopStreaming(c.id);
      deleteProject(project.id);
      onDeleted?.();
    },
  });
}

type MenuOptions = {
  /** The menu is on the project's own page. */
  onProjectPage?: boolean;
  /** Before a new chat in the project is shown. */
  onNewChat?: () => void;
  /** After the project is deleted. */
  onDeleted?: () => void;
  /** Before opening the edit or instructions screen. */
  onNavigate?: () => void;
};

/** The actions on a project, as in ChatGPT's long-press menu. */
export function projectActions(project: Project, opts: MenuOptions = {}): MenuItem[] {
  const pinned = !!project.pinnedAt;
  return [
    {
      label: 'New project chat',
      icon: { feather: 'edit' },
      onPress: () => {
        opts.onNewChat?.();
        openProjectChat(project.id, null, opts.onProjectPage);
      },
    },
    {
      label: pinned ? 'Unpin project' : 'Pin project',
      icon: { mci: pinned ? 'pin-off-outline' : 'pin-outline' },
      onPress: () => useProjects.getState().setPinned(project.id, !pinned),
    },
    {
      label: 'Edit project',
      icon: { feather: 'edit-2' },
      onPress: () => {
        opts.onNavigate?.();
        router.push({ pathname: '/projects/edit', params: { id: project.id } });
      },
    },
    {
      label: 'Edit instructions',
      icon: { feather: 'sliders' },
      onPress: () => {
        opts.onNavigate?.();
        router.push({ pathname: '/projects/instructions', params: { id: project.id } });
      },
    },
    {
      label: 'Delete project',
      icon: { feather: 'trash-2' },
      destructive: true,
      onPress: () => confirmDeleteProject(project, opts.onDeleted),
    },
  ];
}

/**
 * A project's popup menu. `show` opens it at the point pressed; render `menu` once on the screen.
 * `opts` adds what happens around the screen-independent actions (closing the drawer, say).
 */
export function useProjectMenu(opts: MenuOptions = {}) {
  const [state, setState] = useState<{ project: Project; anchor: MenuAnchor } | null>(null);
  const show = useCallback((project: Project, anchor: MenuAnchor) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setState({ project, anchor });
  }, []);
  const menu = (
    <ContextMenu
      anchor={state?.anchor ?? null}
      items={state ? projectActions(state.project, opts) : []}
      onClose={() => setState(null)}
    />
  );
  return { show, menu };
}
