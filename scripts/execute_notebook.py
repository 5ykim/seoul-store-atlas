"""분석 노트북을 실행하고 표·그래프 출력을 함께 저장합니다.

필요한 도구: nbformat, jupyter_client, ipykernel, matplotlib
실행: python scripts/execute_notebook.py
"""
from pathlib import Path
import os
import sys

import nbformat
from jupyter_client import KernelManager

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "analysis.ipynb"
notebook = nbformat.read(path, as_version=4)
manager = KernelManager(kernel_name="python3")
# 현재 분석 환경과 같은 Python을 사용합니다. 전역 커널 설정은 바꾸지 않습니다.
manager.kernel_spec.argv = [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"]
runtime = ROOT / ".qa/ipython"
runtime.mkdir(parents=True, exist_ok=True)
kernel_env = os.environ.copy()
kernel_env["IPYTHONDIR"] = str(runtime)
manager.start_kernel(cwd=str(ROOT), env=kernel_env)
client = manager.blocking_client()
client.start_channels()


def execute(source):
    message_id = client.execute(source)
    outputs = []
    execution_count = None
    while True:
        message = client.get_iopub_msg(timeout=120)
        if message.get("parent_header", {}).get("msg_id") != message_id:
            continue
        kind, content = message["msg_type"], message["content"]
        if kind == "execute_input":
            execution_count = content["execution_count"]
        elif kind in {"stream", "display_data", "execute_result", "error"}:
            outputs.append(nbformat.v4.output_from_msg(message))
            if kind == "error":
                raise RuntimeError(f"{content['ename']}: {content['evalue']}")
        elif kind == "status" and content["execution_state"] == "idle":
            return execution_count, outputs


try:
    client.wait_for_ready(timeout=45)
    execute("%matplotlib inline")
    count = 0
    for cell in notebook.cells:
        if cell.cell_type == "code":
            cell.execution_count, cell.outputs = execute(cell.source)
            count += 1
    nbformat.write(notebook, path)
    print(f"노트북 {count}개 코드 셀 실행 및 출력 저장 완료")
finally:
    client.stop_channels()
    manager.shutdown_kernel(now=True)
