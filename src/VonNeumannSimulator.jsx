import React, { useEffect, useMemo, useRef, useState } from "react";

/* ================= Helpers + ISA ================= */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const isNumber = (x) => typeof x === "number" && !Number.isNaN(x);

function parseInstr(raw) {
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
    case "MULM": 
    case "DIVM":  
      return { op, args: [Number.isFinite(num) ? num : 0] };
    default:
      return { op: "INVALID", args: [txt] };
  }
}
function parseData(cell) {
  if (isNumber(cell)) return cell;
  if (typeof cell === "string") {
    const n = Number(cell.trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/* ================= Config ================= */
const sampleProgram = ["LOAD 2", "ADD 2", "STORE 15", "OUT", "HLT"]; // ojo: mem pequeña
const defaultMemSize = 16;

/* ================= UI Aux ================= */
function Card({ title, children }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {children}
    </div>
  );
}
function Reg({ label, value, highlight }) {
  return (
    <div className={`reg ${highlight ? "ring" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{String(value)}</div>
    </div>
  );
}
function MemoryGrid({ memory, pc, target, op, onEdit }) {
  return (
    <div className="memory">
      {memory.map((cell, i) => {
        const isPC = i === pc;
        const isTarget = target === i;
        const cls = isTarget ? (op === "STORE" ? "dest" : "src") : "";
        return (
          <div key={i} className={`cell ${isPC ? "pc" : ""} ${cls}`}>
            <div className="addr">[{i}]</div>
            <input
              value={String(cell)}
              onChange={(e) => onEdit(i, e.target.value)}
              placeholder="(vacío)"
            />
          </div>
        );
      })}
    </div>
  );
}

/* ================= Simulador ================= */
export default function VonNeumannSimulator() {
  // Estado react
  const [memSize] = useState(defaultMemSize);
  const [memory, setMemory] = useState(() =>
    Array.from({ length: defaultMemSize }, () => "")
  );
  const [pc, setPC] = useState(0);
  const [ir, setIR] = useState("NOP");
  const [acc, setACC] = useState(0);
  const [phase, setPhase] = useState("Idle"); // Idle | Fetch | Decode | Execute
  const [running, setRunning] = useState(false);
  const [halted, setHalted] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const [lastAction, setLastAction] = useState("");
  const [outputs, setOutputs] = useState([]);
  // Operación elegida para generar el programa
  const [opQuick, setOpQuick] = useState("ADD"); // "ADD"

    // === Editor y variables (X, Y, Z) ===
  const [programText, setProgramText] = useState(`// X + Y = Z
  LOAD X
  ADD Y
  STORE Z
  HLT`);

  const [vars, setVars] = useState({
    X: 2,
    Y: 2,
  });

  // REFS “vivas” para lectura en el bucle
  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const haltedRef  = useRef(false);
  const speedRef   = useRef(speedMs);
  const phaseRef   = useRef("Idle");
  const irRef      = useRef("NOP");
  const pcRef      = useRef(0);
  const accRef     = useRef(0);
  const memRef     = useRef(memory);

  // Sincroniza refs al cambiar estado
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { haltedRef.current  = halted;  }, [halted]);
  useEffect(() => { speedRef.current   = speedMs; }, [speedMs]);
  useEffect(() => { phaseRef.current   = phase;   }, [phase]);
  useEffect(() => { irRef.current      = ir;      }, [ir]);
  useEffect(() => { pcRef.current      = pc;      }, [pc]);
  useEffect(() => { accRef.current     = acc;     }, [acc]);
  useEffect(() => { memRef.current     = memory;  }, [memory]);

  // Limpieza global
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);


  /* ===== Fases basadas en REFS ===== */
  function doFetch() {
    setPhase("Fetch");
    const m = memRef.current;
    const p = pcRef.current;
    const instr = m[p];
    setIR(instr ?? "NOP");
    // adelanta ref de IR inmediatamente para que Decode vea el valor actual
    irRef.current = instr ?? "NOP";
    setLastAction(`FETCH @${p}: ${instr || "NOP"}`);
  }

  function doDecode() {
    setPhase("Decode");
    const p = parseInstr(irRef.current);
    setLastAction(`DECODE: ${p.op}${p.args[0] !== undefined ? " " + p.args[0] : ""}`);
  }

  function writeMem(addr, value) {
    const a = clamp(addr, 0, memSize - 1);
    setMemory((m) => {
      const copy = m.slice();
      copy[a] = value;
      return copy;
    });
    // sincroniza ref inmediatamente (para próximas lecturas)
    memRef.current = (() => {
      const c = memRef.current.slice();
      c[a] = value;
      return c;
    })();
  }

  function doExecute() {
    setPhase("Execute");
    const { op, args } = parseInstr(irRef.current);
    const arg = args[0];
    const next = () => {
      const newPC = clamp(pcRef.current + 1, 0, memSize - 1);
      setPC(newPC);
      pcRef.current = newPC;
    };

    switch (op) {
      case "NOP": setLastAction("EXEC: NOP"); next(); break;

      case "HLT":
        setLastAction("EXEC: HLT (CPU detenida)");
        setHalted(true); haltedRef.current = true;
        setRunning(false); runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        break;

      case "LOAD":
        setACC(arg); accRef.current = arg;
        setLastAction(`EXEC: LOAD #${arg} → ACC=${arg}`); next(); break;

      case "LOADI": {
        const v = parseData(memRef.current[arg]);
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: LOADI [${arg}] → ACC=${v}`); next(); break;
      }

      case "MUL": {
        const v = acc * arg;
        setACC(v);
        setLastAction(`EXEC: MUL #${arg} → ACC=${v}`);
        next();
        break;
      }
      case "DIV": {
        const v = arg !== 0 ? Math.floor(acc / arg) : 0;
        setACC(v);
        setLastAction(`EXEC: DIV #${arg} → ACC=${v}`);
        next();
        break;
      }

      case "MULM": {
        const m = parseData(memory[arg]);
        const v = acc * m;
        setACC(v);
        setLastAction(`EXEC: MULM [${arg}]=${m} → ACC=${v}`);
        next();
        break;
      }

      case "DIVM": {
        const m = parseData(memory[arg]);
        if (m === 0) {
          setACC(0);
          setLastAction(`EXEC: DIVM [${arg}]=${m} (÷0) → ACC=0`);
        } else {
          const v = Math.trunc(acc / m);
          setACC(v);
          setLastAction(`EXEC: DIVM [${arg}]=${m} → ACC=${v}`);
        }
        next();
        break;
      }

      case "STORE":
        writeMem(arg, accRef.current);
        setLastAction(`EXEC: STORE ACC(${accRef.current}) → [${arg}]`);
        next(); break;

      case "ADD": {
        const v = accRef.current + arg;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: ADD #${arg} → ACC=${v}`); next(); break;
      }

      case "ADDM": {
        const m = parseData(memRef.current[arg]);
        const v = accRef.current + m;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: ADDM [${arg}]=${m} → ACC=${v}`); next(); break;
      }

      case "SUB": {
        const v = accRef.current - arg;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: SUB #${arg} → ACC=${v}`); next(); break;
      }

      case "SUBM": {
        const m = parseData(memRef.current[arg]);
        const v = accRef.current - m;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: SUBM [${arg}]=${m} → ACC=${v}`); next(); break;
      }

      case "JMP":
        setPC(clamp(arg, 0, memSize - 1));
        pcRef.current = clamp(arg, 0, memSize - 1);
        setLastAction(`EXEC: JMP → PC=${arg}`);
        break;

      case "JZ":
        if (accRef.current === 0) {
          setPC(clamp(arg, 0, memSize - 1));
          pcRef.current = clamp(arg, 0, memSize - 1);
          setLastAction(`EXEC: JZ (ACC=0) → PC=${arg}`);
        } else { setLastAction("EXEC: JZ (no salta)"); next(); }
        break;

      case "JNZ":
        if (accRef.current !== 0) {
          setPC(clamp(arg, 0, memSize - 1));
          pcRef.current = clamp(arg, 0, memSize - 1);
          setLastAction(`EXEC: JNZ (ACC!=0) → PC=${arg}`);
        } else { setLastAction("EXEC: JNZ (no salta)"); next(); }
        break;

      case "OUT":
        setLastAction(`EXEC: OUT → ${accRef.current}`);
        setOutputs((o) => [...o, accRef.current].slice(-50));
        next(); break;

      case "DATA": setLastAction("EXEC: DATA (sin efecto)"); next(); break;

      case "INVALID":
        setLastAction("ERROR: instrucción inválida");
        setHalted(true); haltedRef.current = true;
        setRunning(false); runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        break;

      default:
        setLastAction(`ERROR: op desconocida ${op}`);
        setHalted(true); haltedRef.current = true;
        setRunning(false); runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
    }
  }

  // Un paso usando la fase desde ref (no se congela por closures)
  function stepOnce() {
    if (haltedRef.current) return;
    const ph = phaseRef.current;
    if (ph === "Idle" || ph === "Execute")      doFetch();
    else if (ph === "Fetch")                    doDecode();
    else if (ph === "Decode")                   doExecute();
  }

  // Bucle automático con setTimeout
  useEffect(() => {
    if (!running || halted) return;
    let canceled = false;
    const tick = () => {
      if (canceled || !runningRef.current || haltedRef.current) return;
      stepOnce();
      timerRef.current = setTimeout(tick, speedRef.current);
    };
    timerRef.current = setTimeout(tick, speedRef.current);
    return () => { canceled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [running, halted]);

  /* ===== Controles ===== */
  function runToggle() {
    if (haltedRef.current) return;
    setRunning((r) => !r); // el efecto arranca/para el bucle
  }
  function resetCPU() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunning(false); runningRef.current = false;
    setHalted(false);  haltedRef.current = false;
    setPhase("Idle");  phaseRef.current = "Idle";
    setPC(0);          pcRef.current = 0;
    setIR("NOP");      irRef.current = "NOP";
    setACC(0);         accRef.current = 0;
    setLastAction("");
    setOutputs([]);
  }
  function clearMemory() {
    const empty = Array.from({ length: memSize }, () => "");
    setMemory(empty);
    memRef.current = empty;
    resetCPU();
  }
  function loadSample() {
    const m = Array.from({ length: memSize }, () => "");
    for (let i = 0; i < sampleProgram.length && i < memSize; i++) m[i] = sampleProgram[i];
    setMemory(m);
    memRef.current = m; // sincroniza ref ya
    resetCPU();
    setLastAction("Programa de ejemplo cargado");
  }

  function applyQuickTemplate(opCode) {
    let nice;
    switch (opCode) {
      case "ADD": nice = "+"; break;
      case "SUB": nice = "-"; break;
      case "MUL": nice = "*"; break;
      case "DIV": nice = "/"; break;
      default: nice = "?";
    }

    const program = [
      `// X ${nice} Y = Z`,
      "LOAD X",
      `${opCode} Y`,
      "STORE Z",
      "HLT",
    ].join("\n");

    setProgramText(program);
    setLastAction(`Plantilla insertada: ${opCode} con X e Y`);
  }

  function compileAndLoad() {
    // 1) Limpia el texto: quita comentarios // y líneas vacías
    const lines = programText
      .split("\n")
      .map((l) => l.split("//")[0].trim())
      .filter((l) => l.length > 0);

    // 2) Direcciones para X, Y, Z a partir del final del programa
    let dataBase = lines.length;
    const X_ADDR = dataBase++;
    const Y_ADDR = dataBase++;
    const Z_ADDR = dataBase++;

    // Si no cabe en memoria, avisa y no cargues
    if (dataBase > memSize) {
      setLastAction("El programa y datos no caben en la memoria actual.");
      return;
    }

    // 3) Ensamblado simple: resuelve nombres
    // LOAD/ADD/SUB usan valor inmediato de la variable
    // STORE/LOADI/ADDM/SUBM/JMP/JZ/JNZ usan dirección
    const addrOps = new Set(["LOADI","ADDM","SUBM","STORE","JMP","JZ","JNZ"]);
    const mem = Array.from({ length: memSize }, () => "");

    const resolveVarToValue = (name) => {
      const key = String(name).toUpperCase();
      if (key === "X") return Number(vars.X) || 0;
      if (key === "Y") return Number(vars.Y) || 0;
      if (key === "Z") return Number(vars.Z) || 0;
      const n = Number(name);
      return Number.isFinite(n) ? n : 0;
    };
    const resolveVarToAddr = (name) => {
      const key = String(name).toUpperCase();
      if (key === "X") return X_ADDR;
      if (key === "Y") return Y_ADDR;
      if (key === "Z") return Z_ADDR;
      const n = Number(name);
      return Number.isFinite(n) ? clamp(n, 0, memSize - 1) : 0;
    };

    for (let i = 0; i < lines.length && i < memSize; i++) {
      const parts = lines[i].replace(/\s+/g, " ").split(" ");
      const op = (parts[0] || "").toUpperCase();
      const rawArg = parts[1];

      if (rawArg === undefined) {
        mem[i] = op; // HLT, NOP, OUT...
      } else {
        const arg = addrOps.has(op)
          ? resolveVarToAddr(rawArg)
          : resolveVarToValue(rawArg);
        mem[i] = `${op} ${arg}`;
      }
    }

    // 4) Escribe valores de X, Y, Z en sus direcciones
    mem[X_ADDR] = Number(vars.X) || 0;
    mem[Y_ADDR] = Number(vars.Y) || 0;
    mem[Z_ADDR] = Number(vars.Z) || 0;

    // 5) Carga memoria y resetea CPU
    setMemory(mem);
    resetCPU();
    setLastAction("Programa compilado y cargado");
  }


  function onEditCell(i, value) {
    setMemory((m) => {
      const copy = m.slice();
      const asNum = Number(value);
      copy[i] = value.trim() === "" ? "" : (Number.isFinite(asNum) ? asNum : value);
      memRef.current = copy; // sincroniza ref
      return copy;
    });
  }

  // Para resaltar destino/operación actual
  const parsedIR = useMemo(() => parseInstr(ir), [ir]);
  const targetAddr = useMemo(() => {
    const { op, args } = parsedIR;
    const addrOps = new Set(["LOADI", "ADDM", "SUBM", "STORE", "JMP", "JZ", "JNZ"]);
    if (addrOps.has(op) && Number.isFinite(args?.[0])) return clamp(args[0], 0, memSize - 1);
    return null;
  }, [parsedIR, memSize]);

  return (
    <div className="app-dark min-h-screen w-full p-4">
      <div className="mx-auto max-w-6xl">
        <header className="topbar">
          <div className="brand">Von Neumann Lab</div>
          <nav className="tools">
            <button className="btn-ghost" onClick={loadSample}>Load sample</button>
            <button className="btn-ghost" onClick={clearMemory}>Clear</button>
          </nav>
        </header>

        <h1>Simulador visual: Máquina de Von Neumann</h1>
        <p className="subtitle">Ciclo <b>Fetch → Decode → Execute</b> con registros PC, IR y ACC. Memoria unificada para instrucciones y datos.</p>

        {/* Fila superior: Registros + Ejecución */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card title="Registros">
            <div className="regs">
              <Reg label="PC" value={pc} highlight={phase !== "Idle"} />
              <Reg label="ACC" value={acc} highlight={phase === "Execute"} />
              <Reg label="Fase" value={phase} />
            </div>
            <div className="ir">
              <div className="label">IR (instrucción actual)</div>
              <div className="irbox">{String(ir)}</div>
            </div>
          </Card>

          <Card title="Ejecución">
            <div className="controls">
              <button className="btn" onClick={stepOnce} disabled={halted}>Paso</button>
              <button className="btn" onClick={runToggle} disabled={halted}>
                {running ? "Pausar" : "Ejecutar"}
              </button>
              <button className="btn" onClick={resetCPU}>Reset</button>
              <button className="btn" onClick={clearMemory}>Limpiar memoria</button>
            </div>
            <div className="note"><b>Última acción:</b> {lastAction || "(aún nada)"}</div>
            <div className="speed">
              <label>Velocidad</label>
              <input type="range" min={150} max={1500} value={speedMs} onChange={(e)=>setSpeedMs(Number(e.target.value))} />
              <span>{speedMs} ms</span>
            </div>
          </Card>
        </div>

        {/* Editor de programa + variables */}
        <Card title="Programa y variables">
            {/* === NUEVO: constructor rápido === */}
            <div className="quick-row">
              <label className="quick-label">
                Operación
                <select
                  className="quick-select"
                  value={opQuick}
                  onChange={(e) => setOpQuick(e.target.value)}
                >
                  <option value="ADD">Suma: X + Y → Z</option>
                  <option value="SUB">Resta: X - Y → Z</option>
                  <option value="MUL">Multiplicación: X * Y → Z</option>
                  <option value="DIV">División: X / Y → Z</option>
                </select>
              </label>

              <button className="btn" onClick={() => applyQuickTemplate(opQuick)}>
                Insertar en editor
              </button>
            </div>
            {/* === FIN NUEVO === */}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Editor */}
            <div>
              <textarea
                className="codearea"
                rows={8}
                value={programText}
                onChange={(e) => setProgramText(e.target.value)}
                spellCheck={false}
              />
              <div style={{ display: "flex", gap: ".5rem", marginTop: ".5rem", flexWrap: "wrap" }}>
                <button className="btn" onClick={compileAndLoad}>Compilar y cargar</button>
                <button
                  className="btn"
                  onClick={() =>
                    setProgramText(`// X + Y = Z
        LOAD X
        ADD Y
        STORE Z
        HLT`)
                  }
                >
                  Ejemplo
                </button>
              </div>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: ".5rem" }}>
                Regla: en <b>LOAD/ADD/SUB</b> el nombre usa su <b>valor</b>. En
                <b> STORE/LOADI/ADDM/SUBM/JMP/JZ/JNZ</b> el nombre usa su <b>dirección</b>.
              </p>
            </div>

            {/* Variables (X, Y, Z) */}
            <div>
              <table className="varTable">
                <thead>
                  <tr><th>Nombre</th><th>Valor</th></tr>
                </thead>
                <tbody>
                  {["X","Y"].map((k) => (
                    <tr key={k}>
                      <td style={{ width: 80 }}>{k}</td>
                      <td>
                        <input
                          type="number"
                          value={vars[k]}
                          onChange={(e) => setVars((v) => ({ ...v, [k]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: ".85rem", marginTop: ".5rem" }}>
                Las variables se guardan al final del programa en memoria.
              </div>
            </div>
          </div>
        </Card>



        {/* Fila inferior: Memoria + OUT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Memoria">
            <MemoryGrid memory={memory} pc={pc} target={targetAddr} op={parsedIR.op} onEdit={onEditCell} />
          </Card>
          <Card title="Salida (OUT)">
            {outputs.length === 0 ? (
              <div className="muted">(sin salida)</div>
            ) : (
              <div className="outs">
                {outputs.map((v, i) => <span key={i} className="chip">{v}</span>)}
              </div>
            )}
          </Card>
        </div>

        <footer className="footer">
          Arquitectura de Von Neumann • Simulador didáctico en una sola página.
        </footer>
      </div>

      {/* Estilos mínimos (compatibles con tu App.css) */}
      <style>{`
        .app-dark{ --bg:#0f1115; --panel:#12151b; --panel2:#0f141a; --text:#e6edf7; --muted:#9fb0c6;
                   --line:#2a3442; --accent:#1e293b; --accent2:#334155; }
        .app-dark{ background:var(--bg); color:var(--text); font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
        h1{ font-size:2.1rem; font-weight:800; margin:.25rem 0 .6rem }
        .subtitle{ color:var(--muted); margin-bottom:1rem }
        .topbar{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; background:var(--panel);
                 border:1px solid var(--line); padding:.6rem .9rem; border-radius:12px; margin-bottom:1rem }
        .brand{ font-weight:700; letter-spacing:.3px }
        .tools{ display:flex; gap:.4rem; flex-wrap:wrap }
        .btn-ghost{ background:transparent; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.35rem .6rem; font-size:.85rem; cursor:pointer }
        .btn-ghost:hover{ background:#161b23 }
        .card{ border-radius:14px; background:var(--panel); border:1px solid var(--line); padding:1rem; box-shadow:0 1px 2px rgba(0,0,0,.35) }
        .card-title{ font-weight:700; margin-bottom:.75rem }
        .btn{ border-radius:14px; background:var(--accent); color:#e6edf7; padding:.55rem .8rem; font-size:.9rem; border:1px solid var(--line); cursor:pointer }
        .btn:hover{ background:var(--accent2) }
        .btn:disabled{ opacity:.45; cursor:not-allowed }
        .controls{ display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:.75rem }
        .note{ background:#151a22; border:1px solid var(--line); border-radius:12px; padding:.55rem; color:#d6deea; margin-bottom:.6rem }
        .speed{ display:flex; align-items:center; gap:.6rem; }
        .speed input{ width:180px }
        .regs{ display:grid; grid-template-columns:repeat(3,1fr); gap:.6rem }
        .reg{ border-radius:12px; border:1px solid var(--line); padding:.7rem; background:var(--panel2) }
        .reg .label{ font-size:.7rem; color:var(--muted) }
        .reg .value{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:1.1rem }
        .ring{ box-shadow:0 0 0 2px rgba(90,162,255,.35) inset }
        .ir{ margin-top:.6rem }
        .ir .irbox{ border:1px solid var(--line); background:var(--panel2); border-radius:10px; padding:.45rem; font-family: ui-monospace, monospace; font-size:.9rem; white-space:nowrap; overflow:auto }
        .memory{ display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem }
        @media(min-width:640px){ .memory{ grid-template-columns:repeat(6,1fr) } }
        @media(min-width:1024px){ .memory{ grid-template-columns:repeat(8,1fr) } }
        .cell{ border-radius:12px; border:1px solid var(--line); background:var(--panel2); padding:.5rem; transition:transform .08s ease, box-shadow .1s }
        .cell:hover{ transform:translateY(-1px); box-shadow:0 8px 18px rgba(0,0,0,.25) }
        .cell .addr{ font-size:.65rem; color:var(--muted); margin-bottom:.25rem }
        .cell input{ width:100%; font-size:.8rem; font-family: ui-monospace, monospace; background:transparent; color:var(--text); outline:none; border:0 }
        .cell.pc{ box-shadow:0 0 0 2px rgba(59,130,246,.5) inset }
        .cell.dest{ box-shadow:0 0 0 2px rgba(22,163,74,.55) inset }
        .cell.src{ box-shadow:0 0 0 2px rgba(245,158,11,.55) inset }
        .outs{ display:flex; gap:.4rem; flex-wrap:wrap }
        .chip{ display:inline-block; padding:.25rem .5rem; border-radius:10px; background:#10141b; border:1px solid var(--line); font-family: ui-monospace, monospace; font-size:.85rem }
        .muted{ color:var(--muted) }
        .footer{ margin-top:1rem; font-size:.75rem; color:#92a3bb; text-align:center; padding-top:.8rem; border-top:1px solid var(--line) }
      `}</style>
    </div>
  );
}
