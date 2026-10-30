"""Expose Hermes's own status-bar metrics through Runs, without changing execution.

Use --check before --apply. Apply to an idle gateway, then restart it. Requires
the canonical Runs implementation with gateway.session_usage.usage_stats.
"""
import argparse
import ast
import difflib
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import tempfile


HELPER = '''def _clanker_run_metrics(adapter, run):
    # Reuse the native status bar's occupancy and rolling throughput, never the
    # cumulative prompt-token ledger as a context estimate. No messages or keys.
    with suppress(Exception):
        if run.admission is not None:
            authority, ref, _ = run.admission
            agent = authority.agent(ref)
        else:
            agent = adapter._active_run_agents.get(run.run_id)
        if agent is None:
            return {}
        from gateway.session_usage import usage_stats
        stats = usage_stats(agent)
        used, maximum = stats.get("context_tokens"), stats.get("context_length")
        metrics = {}
        if isinstance(used, (int, float)) and isinstance(maximum, (int, float)) and used > 0 and maximum > 0:
            metrics.update(context_used=used, context_max=maximum,
                           context_estimated=stats.get("context_source") != "provider_usage")
        speed = stats.get("tokens_per_s")
        if isinstance(speed, (int, float)) and speed >= 0:
            metrics["tokens_per_s"] = speed
        prompt, cached = stats.get("prompt_tokens"), stats.get("cache_read_tokens")
        if isinstance(prompt, (int, float)) and prompt > 0 and isinstance(cached, (int, float)) and cached >= 0:
            metrics["cache_hit_pct"] = max(0, min(100, cached / prompt * 100))
        return metrics
    return {}


'''

SAMPLER = '''    # Clanker compatibility: publish only the native Hermes usage projection.
    async def _clanker_sample_metrics():
        previous = None
        while True:
            metrics = await asyncio.to_thread(_clanker_run_metrics, self, run)
            if metrics and metrics != previous and run_id in self._run_streams:
                run.put_event(_run_event(run_id, "usage.update", clanker_metrics=metrics))
                previous = metrics
            await asyncio.sleep(1)

    _clanker_metrics_task = asyncio.create_task(_clanker_sample_metrics())

'''


def patch_source(source):
    ast.parse(source)
    if 'def _clanker_run_metrics(' in source:
        if all(marker in source for marker in ('_clanker_metrics_task.cancel()', 'extra["clanker_metrics"]', '"created_at", "clanker_metrics"')):
            return source
        raise ValueError('Incomplete metrics patch; restore the backup before applying.')
    anchors = [
        ('async def _execute_run(', HELPER + 'async def _execute_run('),
        ('    def _finish(status: str, extra: Optional[dict] = None, **fields: Any) -> None:', SAMPLER + '    def _finish(status: str, extra: Optional[dict] = None, **fields: Any) -> None:'),
        ('        extra = extra or {}\n', '        extra = dict(extra or {})\n        if metrics := _clanker_run_metrics(self, run):\n            extra["clanker_metrics"] = metrics\n'),
        ('    finally:\n        # On cancellation (/stop)', '    finally:\n        _clanker_metrics_task.cancel()\n        with suppress(asyncio.CancelledError):\n            await _clanker_metrics_task\n        # On cancellation (/stop)'),
        ('("model", "runtime", "created_at")', '("model", "runtime", "created_at", "clanker_metrics")'),
    ]
    result = source
    for before, after in anchors:
        if result.count(before) != 1:
            raise ValueError('Unsupported Hermes revision: metrics anchor was not unique. No changes made.')
        result = result.replace(before, after, 1)
    ast.parse(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    target = args.source.resolve(strict=True)
    if target.name != 'api_server_runs.py':
        parser.error('The target must be the Hermes api_server_runs.py module.')
    if not (target.parents[1] / 'session_usage.py').is_file():
        parser.error('This Hermes revision has no gateway/session_usage.py. Update Hermes.')
    original = target.read_bytes()
    source = original.decode('utf-8').replace('\r\n', '\n')
    updated = patch_source(source)
    if updated == source:
        print('Runs metrics forwarding is already installed.')
        return
    if args.check:
        print(''.join(difflib.unified_diff(source.splitlines(keepends=True), updated.splitlines(keepends=True), fromfile=str(target), tofile=str(target) + ' (proposed)')))
        return
    backup = target.with_name(target.name + '.clanker-metrics-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.bak')
    shutil.copy2(target, backup)
    newline = '\r\n' if b'\r\n' in original else '\n'
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False, suffix='.tmp') as temp:
        temp.write(updated.replace('\n', newline).encode('utf-8'))
        temp_path = Path(temp.name)
    try:
        shutil.copymode(target, temp_path)
        os.replace(temp_path, target)
    finally:
        temp_path.unlink(missing_ok=True)
    print('Installed Runs metrics forwarding. Backup: ' + str(backup))
    print('Restart the idle Hermes gateway to load the change.')


if __name__ == '__main__':
    main()
