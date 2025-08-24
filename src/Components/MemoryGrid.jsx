import React from "react";

export default function MemoryGrid({ memory, pc, target, op, onEdit }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
      {memory.map((cell, i) => {
        const isPC = i === pc;
        const isTarget = target === i;
        const targetRing = isTarget ? (op === "STORE" ? "ring-2 ring-green-500" : "ring-2 ring-amber-500") : "";
        return (
          <div key={i} className={`rounded-xl border p-2 bg-white ${isPC ? "ring-2 ring-blue-500" : ""} ${targetRing}`}>
            <div className="text-[10px] text-slate-500 mb-1">[{i}]</div>
            <input
              className="w-full text-xs font-mono bg-transparent outline-none"
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
