import React from "react";

export default function MemoryGrid({ memory, pc, target, op, onEdit }) {
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
