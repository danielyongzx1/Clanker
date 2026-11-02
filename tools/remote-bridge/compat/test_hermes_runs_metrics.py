import ast
from contextlib import suppress
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from hermes_runs_metrics import HELPER, patch_source


SOURCE = '''def _durable_run_status(self):
    return {key: retained[key] for key in ("model", "runtime", "created_at")}

async def _execute_run(self, run):
    def _finish(status: str, extra: Optional[dict] = None, **fields: Any) -> None:
        extra = extra or {}
    try:
        pass
    finally:
        # On cancellation (/stop)
        pass
'''


class MetricsForwarding(unittest.TestCase):
    def test_native_context_is_not_cumulative_tokens_and_uses_native_speed(self):
        stats = dict(context_tokens=12000, context_length=64000, context_source='provider_usage',
                     prompt_tokens=3000000, cache_read_tokens=750000, tokens_per_s=44.5)
        namespace = dict(suppress=suppress)
        exec(compile(ast.parse(HELPER), '<metrics helper>', 'exec'), namespace)
        agent = object()
        authority = SimpleNamespace(agent=lambda ref: agent)
        run = SimpleNamespace(admission=(authority, 'session', {}))
        with patch.dict(sys.modules, {'gateway.session_usage': SimpleNamespace(usage_stats=lambda a: stats)}):
            metrics = namespace['_clanker_run_metrics'](None, run)
            self.assertEqual(metrics, dict(context_used=12000, context_max=64000, context_estimated=False,
                                           tokens_per_s=44.5, cache_hit_pct=25))
            stats['cache_read_tokens'] = 0
            self.assertEqual(namespace['_clanker_run_metrics'](None, run)['cache_hit_pct'], 0)
            # Legacy Runs use the same agent projection; unavailable usage stays absent.
            run.admission = None
            run.run_id = 'run'
            adapter = SimpleNamespace(_active_run_agents={'run': agent})
            self.assertEqual(namespace['_clanker_run_metrics'](adapter, run)['context_used'], 12000)
            adapter._active_run_agents.clear()
            self.assertEqual(namespace['_clanker_run_metrics'](adapter, run), {})

    def test_patch_is_idempotent_preserves_poll_metadata_and_stops_sampler(self):
        result = patch_source(SOURCE)
        self.assertEqual(patch_source(result), result)
        self.assertIn('"created_at", "clanker_metrics"', result)
        self.assertIn('_clanker_metrics_task.cancel()', result)
        self.assertIn('await _clanker_metrics_task', result)
        with self.assertRaises(ValueError):
            patch_source(SOURCE.replace('extra = extra or {}', 'unknown = 1'))


if __name__ == '__main__':
    unittest.main()
