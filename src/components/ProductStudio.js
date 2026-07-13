import React from "react";
import BlenderRenderPanel from "./BlenderRenderPanel";

export default function ProductStudio({ user }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Product image studio</h1>
          <div className="sub">Turn a card + background artwork into a full Blender product render on your PC.</div>
        </div>
      </div>
      <BlenderRenderPanel user={user} />
    </div>
  );
}
