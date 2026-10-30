"""LLDB callbacks for Unity 2022.3 arm64 particle jobs; records execution, not scheduling."""

import json
import os
import struct

import lldb

state = {"frame": 0, "map": {}, "breakpoints": []}


def record(row):
    with open(os.environ["NATSUME_NATIVE_TRACE"], "a", encoding="utf-8") as output:
        output.write(json.dumps(row) + "\n")


def read_pointer(frame, address):
    error = lldb.SBError()
    data = frame.GetThread().GetProcess().ReadMemory(address, 8, error)
    if not error.Success():
        raise RuntimeError(str(error))
    return struct.unpack("<Q", data)[0]


def begin(frame, _location, _internal):
    if not state["map"]:
        path = os.environ["NATSUME_NATIVE_MAP"]
        if not os.path.exists(path):
            return False
        with open(path, encoding="utf-8") as source:
            state["map"] = {row["ptr"]: row["key"] for row in json.load(source)["rows"]}
    state["frame"] += 1
    if state["frame"] > 120:
        for breakpoint in state["breakpoints"]:
            breakpoint.SetEnabled(False)
    else:
        record({"event": "begin", "frame": state["frame"]})
    return False


def execute(frame, _location, _internal):
    if not state["map"] or not 0 < state["frame"] <= 120:
        return False
    data = frame.FindRegister("x0").GetValueAsUnsigned()
    key = state["map"].get(read_pointer(frame, data))
    if key is not None:
        record({"event": "execute", "frame": state["frame"], "key": key})
    return False


def __lldb_init_module(debugger, _internal):
    target = debugger.GetSelectedTarget()
    if "arm64" not in target.GetTriple():
        raise RuntimeError("Shared-order tracing requires the Unity arm64 Editor")
    with open(os.environ["NATSUME_NATIVE_TRACE"], "w", encoding="utf-8"):
        pass
    for symbol, callback in [
        ("ParticleSystem::BeginUpdate(ParticleSystem**, unsigned long, float, float)", "begin"),
        ("ParticleSystem::UpdateFunction(ParticleSystemUpdateData*)", "execute"),
    ]:
        breakpoint = target.BreakpointCreateByName(symbol)
        if not breakpoint.GetNumLocations():
            raise RuntimeError("Unity particle symbol unavailable: " + symbol)
        breakpoint.SetScriptCallbackFunction(__name__ + "." + callback)
        state["breakpoints"].append(breakpoint)
