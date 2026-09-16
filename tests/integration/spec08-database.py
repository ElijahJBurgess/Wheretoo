#!/usr/bin/env python3
"""Delegate to this checkout's sole guarded disposable integration database."""
import pathlib, runpy
_globals = runpy.run_path(str(pathlib.Path(__file__).with_name('spec10-spec11-database.py')))
globals().update({key: value for key, value in _globals.items() if not key.startswith('__')})
if __name__ == '__main__':
    main()
