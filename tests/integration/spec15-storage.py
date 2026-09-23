"""Current manual-image contract proof, including revision-safe AI selection.
The former append/reorder HTTP contract was replaced by Phase 1 guarded commits.
Uses only the dedicated AI-cover local stack, never the old/shared Spec 15 stack.
"""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('ai-cover-storage.py')), run_name='__main__')
