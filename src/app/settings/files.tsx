import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FileList } from '@/components/FileList';
import { workspaceLabel } from '@/lib/projects';
import { Workspace } from '@/lib/workspace';

/** The files in one workspace, from Settings → Workspace files. */
export default function WorkspaceFilesScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const workspace = useMemo(() => new Workspace(key ?? 'shared'), [key]);

  return (
    <>
      <Stack.Screen options={{ title: workspaceLabel(workspace) }} />
      <FileList workspace={workspace} empty="Nothing here yet." allowClear />
    </>
  );
}
