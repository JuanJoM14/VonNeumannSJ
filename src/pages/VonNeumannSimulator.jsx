import React, { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import Reg from "../components/Reg";
import MemoryGrid from "../components/MemoryGrid";
import {
  clamp,
  parseInstr,
  parseData,
  sampleProgram,
  defaultMemSize,
} from "../utils/cpuHelpers";
import "./simulator.css";

export default function VonNeumannSimulator() {
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
  const [opQuick, setOpQuick] = useState("ADD");

  const [programText, setProgramText] = useState(`// X + Y = Z
  LOAD X
  ADD Y
  STORE Z
  OUT
  HLT`);

  const [vars, setVars] = useState({
    X: 2,
    Y: 2,
  });

  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const haltedRef  = useRef(false);
  const speedRef   = useRef(speedMs);
  const phaseRef   = useRef("Idle");
  const irRef      = useRef("NOP");
  const pcRef      = useRef(0);
  const accRef     = useRef(0);
  const memRef     = useRef(memory);

  const [history, setHistory] = useState([]);   // [{ts: number, text: string}]
  const historyEndRef = useRef(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { haltedRef.current  = halted;  }, [halted]);
  useEffect(() => { speedRef.current   = speedMs; }, [speedMs]);
  useEffect(() => { phaseRef.current   = phase;   }, [phase]);
  useEffect(() => { irRef.current      = ir;      }, [ir]);
  useEffect(() => { pcRef.current      = pc;      }, [pc]);
  useEffect(() => { accRef.current     = acc;     }, [acc]);
  useEffect(() => { memRef.current     = memory;  }, [memory]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    if (!lastAction) return;
    setHistory((h) => {
      if (h.length && h[h.length - 1].text === lastAction) return h;
      const entry = { ts: Date.now(), text: lastAction };
      return [...h, entry].slice(-1000);
    });
  }, [lastAction]);

  // funcion para autoscroll (Desactivada)
  // useEffect(() => {
  //   historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [history]);

  function doFetch() {
    setPhase("Fetch");
    const m = memRef.current;
    const p = pcRef.current;
    const instr = m[p];
    setIR(instr ?? "NOP");
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
        const v = accRef.current * arg;
        setACC(v);
        setLastAction(`EXEC: MUL #${arg} → ACC=${v}`);
        next();
        break;
      }
      case "DIV": {
        if (arg === 0) {
          setACC(0);
          setLastAction(`EXEC: DIV #${arg} (÷0) → ACC=0`);
        } else {
          const v = Math.trunc(accRef.current / arg);
          setACC(v);
          setLastAction(`EXEC: DIV #${arg} → ACC=${v}`);
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

  function stepOnce() {
    if (haltedRef.current) return;
    const ph = phaseRef.current;
    if (ph === "Idle" || ph === "Execute")      doFetch();
    else if (ph === "Fetch")                    doDecode();
    else if (ph === "Decode")                   doExecute();
  }

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

  function runToggle() {
    if (haltedRef.current) return;
    setRunning((r) => !r);
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
    setHistory([]);
  }
  function clearMemory() {
    const empty = Array.from({ length: memSize }, () => "");
    setMemory(empty);
    memRef.current = empty;
    resetCPU();
    setHistory([]); 
  }
  function loadSample() {
    const m = Array.from({ length: memSize }, () => "");
    for (let i = 0; i < sampleProgram.length && i < memSize; i++) m[i] = sampleProgram[i];
    setMemory(m);
    memRef.current = m;
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
      "OUT",
      "HLT",
    ].join("\n");

    setProgramText(program);
    setLastAction(`Plantilla insertada: ${opCode} con X e Y`);
  }

  function compileAndLoad() {
    const lines = programText
      .split("\n")
      .map((l) => l.split("//")[0].trim())
      .filter((l) => l.length > 0);

    let dataBase = lines.length;
    const X_ADDR = dataBase++;
    const Y_ADDR = dataBase++;
    const Z_ADDR = dataBase++;

    if (dataBase > memSize) {
      setLastAction("El programa y datos no caben en la memoria actual.");
      return;
    }

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
        mem[i] = op;
      } else {
        const arg = addrOps.has(op)
          ? resolveVarToAddr(rawArg)
          : resolveVarToValue(rawArg);
        mem[i] = `${op} ${arg}`;
      }
    }

    mem[X_ADDR] = Number(vars.X) || 0;
    mem[Y_ADDR] = Number(vars.Y) || 0;
    mem[Z_ADDR] = Number(vars.Z) || 0;

    setMemory(mem);
    resetCPU();
    setLastAction("Programa compilado y cargado");
  }

  function onEditCell(i, value) {
    setMemory((m) => {
      const copy = m.slice();
      const asNum = Number(value);
      copy[i] = value.trim() === "" ? "" : (Number.isFinite(asNum) ? asNum : value);
      memRef.current = copy;
      return copy;
    });
  }

  const parsedIR = useMemo(() => parseInstr(ir), [ir]);
  const targetAddr = useMemo(() => {
    const { op, args } = parsedIR;
    const addrOps = new Set(["LOADI", "ADDM", "SUBM", "STORE", "JMP", "JZ", "JNZ"]);
    if (addrOps.has(op) && Number.isFinite(args?.[0])) return clamp(args[0], 0, memSize - 1);
    return null;
  }, [parsedIR, memSize]);

  return (
    <div className="app-dark min-h-screen w-full p-4">
      <div className="mx-auto max-w-6x1">

        <h1>Simulador visual: Máquina de Von Neumann</h1>
        <p className="subtitle">Ciclo <b>Fetch → Decode → Execute</b> con registros PC, IR y ACC. Memoria unificada para instrucciones y datos.</p>

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

        <Card title="Programa y variables">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        
        <Card title="Consola (historial)">
          <div className="console-box">
            {history.length === 0 ? (
              <div className="muted">(sin mensajes aún)</div>
            ) : (
              history.map((e, i) => (
                <div key={i} className="console-line">
                  <span className="ts">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="msg">{e.text}</span>
                </div>
              ))
            )}
            <div ref={historyEndRef} />
          </div>
          <div style={{ marginTop: ".5rem", display: "flex", gap: ".5rem" }}>
            <button className="btn" onClick={() => setHistory([])}>Limpiar consola</button>
          </div>
        </Card>

        <footer className="footer">
          Arquitectura de Von Neumann
        </footer>
      </div>
    </div>
  );
}
