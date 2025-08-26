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

/* =========================================================
   Simulador visual de una CPU estilo Von Neumann
   - Memoria unificada (instrucciones + datos en el mismo arreglo)
   - Registros: PC (program counter), IR (instrucción actual), ACC (acumulador)
   - Ciclo: Fetch → Decode → Execute
   ========================================================= */

export default function VonNeumannSimulator() {
  /* ------------------ Estado visible en UI ------------------ */
  const [memSize] = useState(defaultMemSize); // Tamaño de memoria (número de celdas)
  const [memory, setMemory] = useState(() =>
    Array.from({ length: defaultMemSize }, () => "")
  );                                          // Memoria de programa/datos
  const [pc, setPC] = useState(0);            // Program Counter: índice de la instrucción actual
  const [ir, setIR] = useState("NOP");        // Instruction Register: instrucción actual en texto
  const [acc, setACC] = useState(0);          // Acumulador: guarda resultados
  const [phase, setPhase] = useState("Idle"); // Fase del ciclo: Idle | Fetch | Decode | Execute
  const [running, setRunning] = useState(false); // Ejecución automática (play/pausa)
  const [halted, setHalted] = useState(false);   // CPU detenida (por HLT o error)
  const [speedMs, setSpeedMs] = useState(600);   // Velocidad del ciclo automático
  const [lastAction, setLastAction] = useState("");// Última acción registrada (texto)
  const [outputs, setOutputs] = useState([]);     // Buffer de salidas (instrucción OUT)
  const [opQuick, setOpQuick] = useState("ADD");  // Operación para plantilla rápida del editor

  /* Editor de "código fuente" (pseudo-ensamblador) */
  const [programText, setProgramText] = useState(`// X + Y = Z
  LOAD X
  ADD Y
  STORE Z
  OUT
  HLT`);

  /* Variables que se insertan al final del programa en memoria */
  const [vars, setVars] = useState({
    X: 2,
    Y: 2,
  });

  /* ------------------ Refs "vivas" (evitan closures viejos) ------------------
     Usamos refs para leer/escribir el estado más reciente dentro del bucle
     automático con setTimeout, sin depender del último render de React.
  --------------------------------------------------------------------------- */
  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const haltedRef  = useRef(false);
  const speedRef   = useRef(speedMs);
  const phaseRef   = useRef("Idle");
  const irRef      = useRef("NOP");
  const pcRef      = useRef(0);
  const accRef     = useRef(0);
  const memRef     = useRef(memory);

  /* Historial de consola: lista de {ts, text} para mostrar eventos */
  const [history, setHistory] = useState([]);   // [{ts: number, text: string}]
  const historyEndRef = useRef(null);

  /* --- Sincroniza las refs cada vez que cambia el estado correspondiente --- */
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { haltedRef.current  = halted;  }, [halted]);
  useEffect(() => { speedRef.current   = speedMs; }, [speedMs]);
  useEffect(() => { phaseRef.current   = phase;   }, [phase]);
  useEffect(() => { irRef.current      = ir;      }, [ir]);
  useEffect(() => { pcRef.current      = pc;      }, [pc]);
  useEffect(() => { accRef.current     = acc;     }, [acc]);
  useEffect(() => { memRef.current     = memory;  }, [memory]);

  /* Limpieza del timer al desmontar el componente */
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  /* Cada "lastAction" nueva se agrega al historial (evita duplicados consecutivos) */
  useEffect(() => {
    if (!lastAction) return;
    setHistory((h) => {
      if (h.length && h[h.length - 1].text === lastAction) return h;
      const entry = { ts: Date.now(), text: lastAction };
      return [...h, entry].slice(-1000); // Conserva máx. 1000 líneas
    });
  }, [lastAction]);

  // función para autoscroll (Desactivada)
  // useEffect(() => {
  //   historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [history]);

  /* ====================== FASE: FETCH ======================
     Lee de memoria[PC] y coloca la instrucción en IR. Además actualiza la ref
     irRef de inmediato para que Decode lea el valor correcto sin esperar render.
  ========================================================== */
  function doFetch() {
    setPhase("Fetch");
    const m = memRef.current;
    const p = pcRef.current;
    const instr = m[p];
    setIR(instr ?? "NOP");
    irRef.current = instr ?? "NOP";
    setLastAction(`FETCH @${p}: ${instr || "NOP"}`);
  }

  /* ====================== FASE: DECODE ======================
     Interpreta el texto de IR (op + arg) pero aún no produce efectos.
  =========================================================== */
  function doDecode() {
    setPhase("Decode");
    const p = parseInstr(irRef.current);
    setLastAction(`DECODE: ${p.op}${p.args[0] !== undefined ? " " + p.args[0] : ""}`);
  }

  /* Escribe en memoria de forma segura y sincroniza memRef al instante.
     Esto evita leer una versión vieja de memoria en el mismo tick. */
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

  /* ====================== FASE: EXECUTE ======================
     Aplica la instrucción actual al estado (ACC/PC/Memoria/Salida).
     Usa refs para trabajar con los valores más recientes.
  ============================================================ */
  function doExecute() {
    setPhase("Execute");
    const { op, args } = parseInstr(irRef.current);
    const arg = args[0];

    // Avanza PC para instrucciones "secuenciales".
    // Las de salto (JMP/JZ/JNZ) ajustan PC por su cuenta.
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
        // Carga inmediata: ACC ← arg
        setACC(arg); accRef.current = arg;
        setLastAction(`EXEC: LOAD #${arg} → ACC=${arg}`); next(); break;

      case "LOADI": {
        // Carga desde memoria: ACC ← Mem[arg]
        const v = parseData(memRef.current[arg]);
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: LOADI [${arg}] → ACC=${v}`); next(); break;
      }

      case "MUL": {
        // Multiplicación inmediata: ACC ← ACC * arg
        const v = accRef.current * arg;
        setACC(v);
        setLastAction(`EXEC: MUL #${arg} → ACC=${v}`);
        next();
        break;
      }
      case "DIV": {
        // División entera inmediata (protege división por 0)
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
        // Guarda ACC en memoria[arg]
        writeMem(arg, accRef.current);
        setLastAction(`EXEC: STORE ACC(${accRef.current}) → [${arg}]`);
        next(); break;

      case "ADD": {
        // Suma inmediata: ACC ← ACC + arg
        const v = accRef.current + arg;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: ADD #${arg} → ACC=${v}`); next(); break;
      }

      case "ADDM": {
        // Suma desde memoria: ACC ← ACC + Mem[arg]
        const m = parseData(memRef.current[arg]);
        const v = accRef.current + m;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: ADDM [${arg}]=${m} → ACC=${v}`); next(); break;
      }

      case "SUB": {
        // Resta inmediata: ACC ← ACC - arg
        const v = accRef.current - arg;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: SUB #${arg} → ACC=${v}`); next(); break;
      }

      case "SUBM": {
        // Resta desde memoria: ACC ← ACC - Mem[arg]
        const m = parseData(memRef.current[arg]);
        const v = accRef.current - m;
        setACC(v); accRef.current = v;
        setLastAction(`EXEC: SUBM [${arg}]=${m} → ACC=${v}`); next(); break;
      }

      case "JMP":
        // Salto incondicional: PC ← arg
        setPC(clamp(arg, 0, memSize - 1));
        pcRef.current = clamp(arg, 0, memSize - 1);
        setLastAction(`EXEC: JMP → PC=${arg}`);
        break;

      case "JZ":
        // Salta si ACC == 0
        if (accRef.current === 0) {
          setPC(clamp(arg, 0, memSize - 1));
          pcRef.current = clamp(arg, 0, memSize - 1);
          setLastAction(`EXEC: JZ (ACC=0) → PC=${arg}`);
        } else { setLastAction("EXEC: JZ (no salta)"); next(); }
        break;

      case "JNZ":
        // Salta si ACC != 0
        if (accRef.current !== 0) {
          setPC(clamp(arg, 0, memSize - 1));
          pcRef.current = clamp(arg, 0, memSize - 1);
          setLastAction(`EXEC: JNZ (ACC!=0) → PC=${arg}`);
        } else { setLastAction("EXEC: JNZ (no salta)"); next(); }
        break;

      case "OUT":
        // Envía el valor de ACC a la lista de salidas (se muestra en chips)
        setLastAction(`EXEC: OUT → ${accRef.current}`);
        setOutputs((o) => [...o, accRef.current].slice(-50));
        next(); break;

      case "DATA": setLastAction("EXEC: DATA (sin efecto)"); next(); break;

      case "INVALID":
        // Instrucción no reconocida → se detiene por seguridad
        setLastAction("ERROR: instrucción inválida");
        setHalted(true); haltedRef.current = true;
        setRunning(false); runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        break;

      default:
        // Protección ante caso no contemplado
        setLastAction(`ERROR: op desconocida ${op}`);
        setHalted(true); haltedRef.current = true;
        setRunning(false); runningRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
    }
  }

  /* Avanza una fase del ciclo según el estado actual:
     Idle/Execute → Fetch → Decode → Execute → (repite)
  */
  function stepOnce() {
    if (haltedRef.current) return;
    const ph = phaseRef.current;
    if (ph === "Idle" || ph === "Execute")      doFetch();
    else if (ph === "Fetch")                    doDecode();
    else if (ph === "Decode")                   doExecute();
  }

  /* Bucle automático (repite stepOnce() cada 'speedMs' milisegundos) */
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

  /* ------------------ Controles básicos ------------------ */
  function runToggle() {
    if (haltedRef.current) return;
    setRunning((r) => !r); // Alterna play/pausa
  }
  function resetCPU() {
    // Resetea registros/fase/salida. (No borra memoria)
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
    // Borra toda la memoria y resetea CPU
    const empty = Array.from({ length: memSize }, () => "");
    setMemory(empty);
    memRef.current = empty;
    resetCPU();
    setHistory([]); 
  }
  function loadSample() {
    // Carga el programa de ejemplo en memoria (útil para demos rápidas)
    const m = Array.from({ length: memSize }, () => "");
    for (let i = 0; i < sampleProgram.length && i < memSize; i++) m[i] = sampleProgram[i];
    setMemory(m);
    memRef.current = m;
    resetCPU();
    setLastAction("Programa de ejemplo cargado");
  }

  /* Inserta una plantilla "X op Y = Z" en el editor, según la operación elegida */
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

  /* Compila el texto del editor a memoria:
     1) Limpia comentarios // y líneas vacías
     2) Reserva direcciones para X, Y, Z al final del programa
     3) Traduce cada instrucción a formato "OP <arg>" resolviendo VALOR o DIRECCIÓN
     4) Escribe valores de X, Y, Z en sus celdas
     5) Carga en memoria y resetea CPU
  */
  function compileAndLoad() {
    const lines = programText
      .split("\n")
      .map((l) => l.split("//")[0].trim())
      .filter((l) => l.length > 0);

    // Direcciones para X/Y/Z (a continuación del programa)
    let dataBase = lines.length;
    const X_ADDR = dataBase++;
    const Y_ADDR = dataBase++;
    const Z_ADDR = dataBase++;

    if (dataBase > memSize) {
      setLastAction("El programa y datos no caben en la memoria actual.");
      return;
    }

    // Instrucciones que esperan DIRECCIÓN (no valor inmediato)
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

    // Ensambla cada línea del programa
    for (let i = 0; i < lines.length && i < memSize; i++) {
      const parts = lines[i].replace(/\s+/g, " ").split(" ");
      const op = (parts[0] || "").toUpperCase();
      const rawArg = parts[1];

      if (rawArg === undefined) {
        mem[i] = op; // Ej.: HLT, NOP, OUT
      } else {
        const arg = addrOps.has(op)
          ? resolveVarToAddr(rawArg)   // Usa DIRECCIÓN en estas ops
          : resolveVarToValue(rawArg); // Usa VALOR inmediato en el resto
        mem[i] = `${op} ${arg}`;
      }
    }

    // Escribe X, Y, Z en sus direcciones
    mem[X_ADDR] = Number(vars.X) || 0;
    mem[Y_ADDR] = Number(vars.Y) || 0;
    mem[Z_ADDR] = Number(vars.Z) || 0;

    // Carga memoria y deja la CPU lista para ejecutar
    setMemory(mem);
    resetCPU();
    setLastAction("Programa compilado y cargado");
  }

  /* Edición manual de celdas de memoria desde la UI */
  function onEditCell(i, value) {
    setMemory((m) => {
      const copy = m.slice();
      const asNum = Number(value);
      copy[i] = value.trim() === "" ? "" : (Number.isFinite(asNum) ? asNum : value);
      memRef.current = copy; // Sincroniza ref para lecturas inmediatas
      return copy;
    });
  }

  /* --------- Cálculos derivados para la UI (useMemo) --------- */
  const parsedIR = useMemo(() => parseInstr(ir), [ir]);

  // Dirección objetivo a resaltar en la grilla (para LOADI/STORE/ADDM/SUBM/JMP/JZ/JNZ)
  const targetAddr = useMemo(() => {
    const { op, args } = parsedIR;
    const addrOps = new Set(["LOADI", "ADDM", "SUBM", "STORE", "JMP", "JZ", "JNZ"]);
    if (addrOps.has(op) && Number.isFinite(args?.[0])) return clamp(args[0], 0, memSize - 1);
    return null;
  }, [parsedIR, memSize]);

  /* ========================== Render UI ========================== */
  return (
    <div className="app-dark min-h-screen w-full p-4">
      <div className="mx-auto max-w-6x1">

        <h1>Simulador visual: Máquina de Von Neumann</h1>
        <p className="subtitle">Ciclo <b>Fetch → Decode → Execute</b> con registros PC, IR y ACC. Memoria unificada para instrucciones y datos.</p>

        {/* Panel superior: registros + controles de ejecución */}
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
              {/* Paso manual de una fase */}
              <button className="btn" onClick={stepOnce} disabled={halted}>Paso</button>
              {/* Play/Pausa del bucle automático */}
              <button className="btn" onClick={runToggle} disabled={halted}>
                {running ? "Pausar" : "Ejecutar"}
              </button>
              {/* Reset de CPU (no borra memoria) */}
              <button className="btn" onClick={resetCPU}>Reset</button>
              {/* Borra memoria y resetea CPU */}
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

        {/* Editor y variables */}
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
              {/* Regla clave para explicar en la exposición */}
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

        {/* Memoria + Salida */}
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
        
        {/* Consola con el historial de acciones (útil para narrar la ejecución) */}
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
