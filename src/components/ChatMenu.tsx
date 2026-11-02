import * as Haptics from '@/lib/haptics';
import { useCallback, useState } from 'react';
import { stopStreaming } from '@/lib/chat';
import { moveChatToProject } from '@/lib/projects';
import { useChats, type Conversation } from '@/store/chats';
import { useProjects } from '@/store/projects';
import { useUI } from '@/store/ui';
import { ContextMenu, type MenuAnchor, type MenuItem } from './ContextMenu';
import { choose, confirm, notify, prompt, type Choice } from './Dialogs';

function move(c: Conversation, projectId: string | null) {
  try {
    const renamed = moveChatToProject(c.id, projectId);
    if (renamed.length) {
      notify(
        'Some files were renamed',
        `These names were taken where the chat moved to:\n${renamed.map(([a, b]) => `${a} → ${b}`).join('\n')}`
      );
    }
  } catch (e) {
    notify('Could not move the chat', e instanceof Error ? e.message : String(e));
  }
}

/** Picks the project to move a chat to: an existing one, a new one, or none. */
function chooseProject(c: Conversation) {
  const projects = Object.values(useProjects.getState().projects).sort(
    (a, b) => Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || a.name.localeCompare(b.name)
  );
  const choices: Choice[] = [
    ...projects.map(
      (p): Choice => ({
        label: p.name,
        icon: { feather: 'folder' },
        selected: p.id === c.projectId,
        onPress: () => move(c, p.id),
      })
    ),
    {
      label: 'New project',
      icon: { feather: 'folder-plus' },
      onPress: () =>
        prompt({
          title: 'New project',
          placeholder: 'Project name',
          confirmLabel: 'Create',
          maxLength: 80,
          onSubmit: (name) => move(c, useProjects.getState().create(name)),
        }),
    },
    ...(c.projectId
      ? [{ label: 'Remove from project', icon: { feather: 'x-circle' as const }, onPress: () => move(c, null) }]
      : []),
  ];
  choose({
    title: c.projectId ? 'Move to project' : 'Add to project',
    message: c.projectId
      ? 'It takes copies of the files it used along, and starts using the new place for files and memory.'
      : 'Its files move along, and it shares the project’s workspace, sources, instructions and memory from then on.',
    choices,
  });
}

export function confirmDeleteChat(c: Conversation) {
  confirm({
    title: 'Delete chat?',
    message: `"${c.title}"${c.projectId || c.workspace ? '' : ' and its files'} will be deleted. This can't be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => {
      stopStreaming(c.id);
      useChats.getState().remove(c.id);
      if (useUI.getState().currentId === c.id) useUI.getState().open(null);
    },
  });
}

/** The actions on a chat, for its long-press menu. */
export function chatActions(c: Conversation): MenuItem[] {
  const chats = useChats.getState();
  return [
    {
      label: c.pinnedAt ? 'Unpin' : 'Pin',
      icon: { mci: c.pinnedAt ? 'pin-off-outline' : 'pin-outline' },
      onPress: () => chats.setPinned(c.id, !c.pinnedAt),
    },
    {
      label: 'Rename',
      icon: { feather: 'edit-2' },
      onPress: () =>
        prompt({
          title: 'Rename chat',
          initial: c.title,
          confirmLabel: 'Save',
          maxLength: 100,
          onSubmit: (title) => useChats.getState().rename(c.id, title),
        }),
    },
    {
      label: c.projectId ? 'Move to project' : 'Add to project',
      icon: { feather: 'folder-plus' },
      onPress: () => chooseProject(c),
    },
    c.archivedAt
      ? { label: 'Unarchive', icon: { feather: 'archive' }, onPress: () => chats.setArchived(c.id, false) }
      : {
          label: 'Archive',
          icon: { feather: 'archive' },
          onPress: () =>
            confirm({
              title: 'Archive chat?',
              message: `"${c.title}" will be hidden from your chats. To see archived chats again, turn on Show archived chats in Settings.`,
              confirmLabel: 'Archive',
              onConfirm: () => useChats.getState().setArchived(c.id, true),
            }),
        },
    { label: 'Delete', icon: { feather: 'trash-2' }, destructive: true, onPress: () => confirmDeleteChat(c) },
  ];
}

/** A chat's popup menu. `show` opens it at the point pressed; render `menu` once on the screen. */
export function useChatMenu() {
  const [state, setState] = useState<{ chat: Conversation; anchor: MenuAnchor } | null>(null);
  const show = useCallback((chat: Conversation, anchor: MenuAnchor) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setState({ chat, anchor });
  }, []);
  const menu = (
    <ContextMenu anchor={state?.anchor ?? null} items={state ? chatActions(state.chat) : []} onClose={() => setState(null)} />
  );
  return { show, menu };
}
