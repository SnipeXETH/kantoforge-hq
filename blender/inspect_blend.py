# KantoForge — read-only probe.
# Open your .blend in Blender → Scripting workspace → New → paste this → Run.
# It changes NOTHING. Copy everything it prints and send it back.
import bpy, os

def show(p):
    try:
        return bpy.path.abspath(p)
    except Exception:
        return p

print("\n================ KF BLEND PROBE ================")
print("blend file :", bpy.data.filepath)

sc = bpy.context.scene
r = sc.render
print("\n--- OUTPUT ---")
print("output path   :", r.filepath, "->", show(r.filepath))
print("file format   :", r.image_settings.file_format)
print("resolution    :", r.resolution_x, "x", r.resolution_y, "@", r.resolution_percentage, "%")
print("engine        :", r.engine)

print("\n--- FRAMES (a frame range usually = one variation per frame) ---")
print("frame start/end/step :", sc.frame_start, sc.frame_end, sc.frame_step)
print("current frame        :", sc.frame_current)

print("\n--- IMAGES (source=SEQUENCE means it advances with the frame) ---")
for img in bpy.data.images:
    print("  name=%r  source=%s  filepath=%r  ->  %s"
          % (img.name, img.source, img.filepath, show(img.filepath)))

print("\n--- SCENES / VIEW LAYERS ---")
for s in bpy.data.scenes:
    print("  scene=%r  view_layers=%s" % (s.name, [vl.name for vl in s.view_layers]))

print("\n--- EMBEDDED SCRIPTS / TEXT BLOCKS (batch logic often lives here) ---")
if not bpy.data.texts:
    print("  (none)")
for t in bpy.data.texts:
    body = t.as_string()
    print("  text=%r  lines=%d  register=%s" % (t.name, len(body.splitlines()), t.use_module))
    print("  ----- first 40 lines -----")
    for line in body.splitlines()[:40]:
        print("    " + line)
    print("  --------------------------")

print("\n--- APP HANDLERS (auto-run on frame change / render) ---")
import bpy.app.handlers as H
for hn in ("frame_change_pre", "frame_change_post", "render_pre", "render_init", "render_write"):
    fns = getattr(H, hn, [])
    print("  %s: %s" % (hn, [getattr(f, '__name__', str(f)) for f in fns]))

print("================ END KF BLEND PROBE ================\n")
