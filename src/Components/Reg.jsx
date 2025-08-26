import React from "react";

export default function Reg({ label, value, highlight }) {
  return (
    <div className={`reg ${highlight ? "ring" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{String(value)}</div>
    </div>
  );
}
