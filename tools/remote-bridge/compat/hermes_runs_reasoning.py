"""Forward Hermes Runs reasoning without changing turn admission or tool execution.

Use --check to review the diff; --apply preserves a backup before changing the
installed gateway module. Restart an idle Hermes gateway to load the fix.
"""
import argparse
import ast
import difflib
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone


def patch_source(source):
    tree = ast.parse(source)
    node = next((item for item in tree.body if isinstance(item, ast.AsyncFunctionDef) and item.name == '_execute_run'), None)
    if node is None:
        raise ValueError('Unsupported Hermes module: _execute_run was not found.')
    lines = source.splitlines(keepends=True)
    original = ''.join(lines[node.lineno - 1:node.end_lineno])
    if 'reasoning_callback=_reasoning_cb' in original and 'def _reasoning_cb(' in original:
        return source
    if 'reasoning_callback=' in original:
        raise ValueError('Hermes already has custom reasoning wiring; no changes made.')
    anchors = [
        ('    def _interim_cb(', '''    # Clanker compatibility: expose the model's emitted reasoning deltas on Runs SSE.
    def _reasoning_cb(delta: Optional[str]) -> None:
        if not delta or run_id not in self._run_streams:
            return
        with suppress(Exception):
            loop.call_soon_threadsafe(run.put_event, _run_event(run_id, "reasoning.delta", delta=delta))

    def _interim_cb('''),
        ('run.admission, stream_delta_callback=_text_cb,', 'run.admission, stream_delta_callback=_text_cb, reasoning_callback=_reasoning_cb,'),
        ('interim_assistant_callback=_interim_cb, **run.agent_kwargs)', 'interim_assistant_callback=_interim_cb, reasoning_callback=_reasoning_cb, **run.agent_kwargs)'),
    ]
    changed = original
    for before, after in anchors:
        if changed.count(before) != 1:
            raise ValueError('Unsupported Hermes revision: expected callback anchor was not unique. No changes made.')
        changed = changed.replace(before, after, 1)
    lines[node.lineno - 1:node.end_lineno] = [changed]
    result = ''.join(lines)
    ast.parse(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Installed gateway/platforms/api_server_runs.py')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    target = args.source.resolve(strict=True)
    if target.name != 'api_server_runs.py':
        parser.error('The target must be the Hermes api_server_runs.py module.')
    original = target.read_bytes()
    source = original.decode('utf-8').replace('\r\n', '\n')
    updated = patch_source(source)
    if updated == source:
        print('Reasoning forwarding is already installed; no changes needed.')
        return
    if args.check:
        print(''.join(difflib.unified_diff(source.splitlines(keepends=True), updated.splitlines(keepends=True), fromfile=str(target), tofile=str(target) + ' (proposed)')))
        return
    backup = target.with_name(target.name + '.clanker-reasoning-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.bak')
    shutil.copy2(target, backup)
    newline = '\r\n' if b'\r\n' in original else '\n'
    encoded = updated.replace('\n', newline).encode('utf-8')
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False, suffix='.tmp') as temp:
        temp.write(encoded)
        temp_path = Path(temp.name)
    try:
        shutil.copymode(target, temp_path)
        os.replace(temp_path, target)
    finally:
        temp_path.unlink(missing_ok=True)
    print('Installed Runs reasoning forwarding. Backup: ' + str(backup))
    print('Restart the Hermes gateway when it has no active turns.')


if __name__ == '__main__':
    main()
