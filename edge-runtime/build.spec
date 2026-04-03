# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 打包配置
# 用法: pyinstaller build.spec

a = Analysis(
    ['client_main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'wss_receiver',
        'edge_scheduler',
        'backup_manager',
        'security_audit',
        'context_navigator',
        'marionette_executor',
        'memory_consolidator',
        'terminal_bridge',
        'jobs',
        'jobs.memory_sync_job',
        'jobs.log_cleanup_job',
        'jobs.task_check_job',
        'event_watcher',
        'event_reporter',
        'socketio',
        'engineio',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['tkinter', 'unittest', 'email', 'xml'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='lobster-edge',
    debug=False,
    strip=True,
    upx=True,
    console=False,
    icon=None,
)
