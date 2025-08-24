// src/cpu.js
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const isNumber = (x) => typeof x === "number" && !Number.isNaN(x);

export function parseInstr(raw) {
  if (raw == null) return { op: "NOP", args: [] };
  if (typeof raw === "number") return { op: "DATA", args: [raw] };
  const txt = String(raw).trim();
  if (txt === "") return { op: "NOP", args: [] };
  const parts = txt.replace(/\s+/g, " ").split(" ");
  const op = parts[0].toUpperCase();
  const arg = parts[1] !== undefined ? parts[1] : undefined;
  const num = arg !== undefined ? Number(arg) : undefined;
  switch (op) {
    case "HLT":
    case "NOP":
    case "OUT":
      return { op, args: [] };
    case "LOAD":
    case "ADD":
    case "SUB":
      return { op, args: [Number.isFinite(num) ? num : 0] };
    case "LOADI":
    case "ADDM":
    case "SUBM":
    case "STORE":
    case "JMP":
    case "JZ":
    case "JNZ":
      return { op, args: [Number.isFinite(num) ? num : 0] };
    default:
      return { op: "INVALID", args: [txt] };
  }
}

export function parseData(cell) {
  if (isNumber(cell)) return cell;
  if (typeof cell === "string") {
    const n = Number(cell.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export const sampleProgram = ["LOAD 5", "ADD 3", "STORE 40", "OUT", "HLT"];

export function targetAddressFromIR(ir, memSize) {
  const { op, args } = parseInstr(ir);
  const addrOps = new Set(["LOADI", "ADDM", "SUBM", "STORE", "JMP", "JZ", "JNZ"]);
  if (addrOps.has(op) && Number.isFinite(args?.[0])) return clamp(args[0], 0, memSize - 1);
  return null;
}

export function step(state) {
  if (state.halted) return { state, lastAction: "CPU detenida" };
  const { memory, pc, ir, acc, phase } = state;
  const nextPC = () => Math.max(0, Math.min(pc + 1, memory.length - 1));

  if (phase === "Idle" || phase === "Execute") {
    const instr = memory[pc];
    const newIR = instr ?? "NOP";
    return { state: { ...state, phase: "Fetch", ir: newIR }, lastAction: `FETCH @${pc}: ${instr || "NOP"}` };
  }
  if (phase === "Fetch") {
    const p = parseInstr(ir);
    return { state: { ...state, phase: "Decode" }, lastAction: `DECODE: ${p.op}${p.args[0] !== undefined ? " " + p.args[0] : ""}` };
  }
  if (phase === "Decode") {
    const { op, args } = parseInstr(ir);
    const arg = args[0];
    switch (op) {
      case "NOP": return { state: { ...state, phase: "Execute", pc: nextPC() }, lastAction: "EXEC: NOP" };
      case "HLT": return { state: { ...state, phase: "Execute", halted: true }, lastAction: "EXEC: HLT (CPU detenida)" };
      case "LOAD": return { state: { ...state, phase: "Execute", acc: arg, pc: nextPC() }, lastAction: `EXEC: LOAD #${arg} → ACC=${arg}` };
      case "LOADI": {
        const v = parseData(memory[arg]);
        return { state: { ...state, phase: "Execute", acc: v, pc: nextPC() }, lastAction: `EXEC: LOADI [${arg}] → ACC=${v}` };
      }
      case "STORE": {
        const m = memory.slice(); m[arg] = state.acc;
        return { state: { ...state, phase: "Execute", memory: m, pc: nextPC() }, lastAction: `EXEC: STORE ACC(${state.acc}) → [${arg}]` };
      }
      case "ADD": {
        const v = acc + arg;
        return { state: { ...state, phase: "Execute", acc: v, pc: nextPC() }, lastAction: `EXEC: ADD #${arg} → ACC=${v}` };
      }
      case "ADDM": {
        const d = parseData(memory[arg]); const v = acc + d;
        return { state: { ...state, phase: "Execute", acc: v, pc: nextPC() }, lastAction: `EXEC: ADDM [${arg}]=${d} → ACC=${v}` };
      }
      case "SUB": {
        const v = acc - arg;
        return { state: { ...state, phase: "Execute", acc: v, pc: nextPC() }, lastAction: `EXEC: SUB #${arg} → ACC=${v}` };
      }
      case "SUBM": {
        const d = parseData(memory[arg]); const v = acc - d;
        return { state: { ...state, phase: "Execute", acc: v, pc: nextPC() }, lastAction: `EXEC: SUBM [${arg}]=${d} → ACC=${v}` };
      }
      case "JMP": return { state: { ...state, phase: "Execute", pc: Math.max(0, Math.min(arg, memory.length - 1)) }, lastAction: `EXEC: JMP → PC=${arg}` };
      case "JZ":
        if (acc === 0) return { state: { ...state, phase: "Execute", pc: Math.max(0, Math.min(arg, memory.length - 1)) }, lastAction: `EXEC: JZ (ACC=0) → PC=${arg}` };
        return { state: { ...state, phase: "Execute", pc: nextPC() }, lastAction: "EXEC: JZ (no salta)" };
      case "JNZ":
        if (acc !== 0) return { state: { ...state, phase: "Execute", pc: Math.max(0, Math.min(arg, memory.length - 1)) }, lastAction: `EXEC: JNZ (ACC!=0) → PC=${arg}` };
        return { state: { ...state, phase: "Execute", pc: nextPC() }, lastAction: "EXEC: JNZ (no salta)" };
      case "OUT": {
        const outs = [...state.outputs, acc].slice(-50);
        return { state: { ...state, phase: "Execute", outputs: outs, pc: nextPC() }, lastAction: `EXEC: OUT → ${acc}` };
      }
      case "DATA": return { state: { ...state, phase: "Execute", pc: nextPC() }, lastAction: "EXEC: DATA (sin efecto)" };
      case "INVALID": return { state: { ...state, phase: "Execute", halted: true }, lastAction: "ERROR: instrucción inválida" };
      default: return { state: { ...state, phase: "Execute", halted: true }, lastAction: `ERROR: op desconocida ${op}` };
    }
  }
  return { state, lastAction: "(sin cambio)" };
}
