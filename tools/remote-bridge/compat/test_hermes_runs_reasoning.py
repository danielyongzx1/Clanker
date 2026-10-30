import ast
from contextlib import suppress
from types import SimpleNamespace
from typing import Optional
import unittest
from hermes_runs_reasoning import patch_source

SOURCE = '''async def _execute_run(self, run):
    def _text_cb(delta):
        pass
    def _interim_cb(text):
        pass
    await observe_api_turn(
        run.admission, stream_delta_callback=_text_cb,
        tool_start_callback=None)
    self._create_agent(
        interim_assistant_callback=_interim_cb, **run.agent_kwargs)
'''


class ReasoningForwarding(unittest.TestCase):
    def test_both_execution_paths_receive_reasoning_and_emit_incrementally(self):
        patched = patch_source(SOURCE)
        self.assertEqual(patched.count('reasoning_callback=_reasoning_cb'), 2)
        callback = next(node for node in ast.walk(ast.parse(patched)) if isinstance(node, ast.FunctionDef) and node.name == '_reasoning_cb')
        events = []
        namespace = dict(Optional=Optional, suppress=suppress, run_id='run', self=SimpleNamespace(_run_streams={'run': object()}),
                         run=SimpleNamespace(put_event=events.append), loop=SimpleNamespace(call_soon_threadsafe=lambda fn, event: fn(event)),
                         _run_event=lambda identity, event, **values: dict(run_id=identity, event=event, **values))
        exec(compile(ast.Module(body=[callback], type_ignores=[]), '<reasoning callback>', 'exec'), namespace)
        namespace['_reasoning_cb']('First ')
        namespace['_reasoning_cb']('second')
        self.assertEqual([event['delta'] for event in events], ['First ', 'second'])
        self.assertTrue(all(event['event'] == 'reasoning.delta' for event in events))
        namespace['self']._run_streams.clear()
        namespace['_reasoning_cb']('late')
        self.assertEqual(len(events), 2)

    def test_idempotent_and_refuses_unknown_layouts(self):
        patched = patch_source(SOURCE)
        self.assertEqual(patch_source(patched), patched)
        with self.assertRaises(ValueError):
            patch_source(SOURCE.replace('run.admission, stream_delta_callback=_text_cb,', 'unsupported_call(),'))


if __name__ == '__main__':
    unittest.main()
