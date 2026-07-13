# Runs INSIDE Blender:  blender -b magnetic_case_BGCROP_rf.blend -P render_job.py
#
# Reproduces the manual KantoForge workflow: drop the card into Artwork/Cards/1.png
# and the background into Artwork/Backgrounds/1.png, then render frame 1. The card
# and background are Image *sequences* in the .blend (frame N -> N.png), so writing
# the "1" slot and rendering frame 1 is exactly what a person does by hand.
#
# The agent passes everything via environment variables:
#   KF_CARD_FILE   full path to the card PNG for this job
#   KF_ART_FILE    full path to the background PNG for this job
#   KF_OUTPUT      full path to write the finished PNG to
#   KF_RES_X/Y     (optional) resolution override
#   KF_SAMPLES     (optional) Cycles sample cap, to trade quality for speed
#   KF_CARDS_SUBDIR / KF_BG_SUBDIR  (optional) override the folder names

import bpy
import os
import time
import shutil


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


blend_path = bpy.data.filepath
if not blend_path:
    raise SystemExit("KF: the .blend has no path on disk — save it first.")
blend_dir = os.path.dirname(blend_path)

cards_dir = os.path.join(blend_dir, *env("KF_CARDS_SUBDIR", "Artwork/Cards").split("/"))
bg_dir = os.path.join(blend_dir, *env("KF_BG_SUBDIR", "Artwork/Backgrounds").split("/"))
os.makedirs(cards_dir, exist_ok=True)
os.makedirs(bg_dir, exist_ok=True)

# 1. Put this job's images into the "1" slot of each folder (overwrites the slot —
#    that's the intended use of the queue folders).
shutil.copyfile(env("KF_CARD_FILE"), os.path.join(cards_dir, "1.png"))
shutil.copyfile(env("KF_ART_FILE"), os.path.join(bg_dir, "1.png"))

scene = bpy.context.scene
scene.frame_set(1)

# 2. Re-read the card/background sequence datablocks so Blender picks up the files
#    we just wrote. We match by the relative "//Artwork\Cards|Backgrounds" path,
#    which selects the real datablocks and skips the stale absolute-path orphan.
reloaded = []
for img in bpy.data.images:
    fp = (img.filepath or "").replace("\\", "/")
    if fp.startswith("//") and ("Cards" in fp or "Backgrounds" in fp):
        try:
            img.reload()
            reloaded.append(img.name)
        except Exception as e:
            print("KF: could not reload", img.name, "-", e)
print("KF: reloaded artwork datablocks:", reloaded)

# 2b. Auto-heal missing textures: this .blend has its case textures baked to a
#     path from another machine. If an image can't be found, look for a file with
#     the same name in the local "textures" folder next to the .blend and use it.
def heal_missing_textures():
    tex_root = os.path.join(blend_dir, "textures")
    if not os.path.isdir(tex_root):
        print("KF: no local 'textures' folder next to the .blend to heal from")
        return
    index = {}
    for root, _dirs, files in os.walk(tex_root):
        for fn in files:
            index.setdefault(fn.lower(), os.path.join(root, fn))
    healed, still = [], []
    for img in bpy.data.images:
        if img.source != "FILE":
            continue
        ap = bpy.path.abspath(img.filepath or "")
        if ap and os.path.exists(ap):
            continue  # already loads fine
        base = os.path.basename((img.filepath or "").replace("\\", "/"))
        if not base:
            continue
        match = index.get(base.lower())
        if match:
            img.filepath = match
            try:
                img.reload()
                healed.append(base)
            except Exception as e:
                print("KF: reload failed for", base, "-", e)
        else:
            still.append(base)
    if healed:
        print("KF: repointed textures to local 'textures' folder:", healed)
    if still:
        print("KF: textures not found locally (may be unused):", still)

heal_missing_textures()

# 3. Warn about any image that has no pixels loaded (e.g. missing marble/metal
#    textures) so a broken first render is easy to diagnose.
missing = []
for img in bpy.data.images:
    if img.source in ("VIEWER", "GENERATED"):
        continue
    try:
        if img.has_data is False and tuple(img.size) == (0, 0):
            missing.append((img.name, bpy.path.abspath(img.filepath or "")))
    except Exception:
        pass
if missing:
    print("KF: WARNING - these images did not load (render may look wrong):")
    for name, path in missing:
        print("KF:   -", name, "->", path)

# 4. Output settings.
r = scene.render
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGBA"
if env("KF_RES_X"):
    r.resolution_x = int(env("KF_RES_X"))
if env("KF_RES_Y"):
    r.resolution_y = int(env("KF_RES_Y"))
r.resolution_percentage = 100

if env("KF_SAMPLES") and hasattr(scene, "cycles"):
    try:
        scene.cycles.samples = int(env("KF_SAMPLES"))
        print("KF: sample cap =", scene.cycles.samples)
    except Exception as e:
        print("KF: could not set sample cap -", e)

# 4b. Use the GPU if one is available (headless Blender defaults to CPU).
#     KF_DEVICE = auto (default, try GPU) | gpu | cpu
def configure_gpu():
    want = (env("KF_DEVICE", "auto") or "auto").lower()
    if want == "cpu" or not hasattr(scene, "cycles"):
        print("KF: rendering device = CPU")
        return
    try:
        cprefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception as e:
        print("KF: no Cycles prefs, using CPU -", e)
        return
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            cprefs.compute_device_type = backend
        except Exception:
            continue
        try:
            cprefs.get_devices()
        except Exception:
            pass
        gpus = [d for d in cprefs.devices if d.type == backend]
        if not gpus:
            continue
        for d in cprefs.devices:
            d.use = (d.type == backend)
        scene.cycles.device = "GPU"
        print("KF: rendering device = GPU (%s): %s" % (backend, [d.name for d in gpus]))
        return
    scene.cycles.device = "CPU"
    print("KF: no supported GPU found — rendering device = CPU")

configure_gpu()

# 5. Render the current frame. This also runs the .blend's compositor, which
#    writes its own File Output nodes (e.g. Renders_Normal / Renders_Overlayed).
bpy.ops.render.render()


# 6. Return the .blend's finished composited image, not the raw render buffer.
#    The compositor writes File Output folders (e.g. Renders_Overlayed with
#    KantoForge branding — the real deliverable). KF_OUTPUT_PREFER picks which.
def newest_image_in(folder):
    exts = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".exr")
    best, best_m = None, -1
    if folder and os.path.isdir(folder):
        for root, _dirs, files in os.walk(folder):
            for fn in files:
                if fn.lower().endswith(exts):
                    p = os.path.join(root, fn)
                    try:
                        m = os.path.getmtime(p)
                    except OSError:
                        continue
                    if m > best_m:
                        best, best_m = p, m
    return best


def slugify(s):
    out = "".join(c if (c.isalnum() or c in "-_.") else "_" for c in (s or "").strip())
    return out.strip("_")[:60]


# The image each compositor File Output just produced this render.
produced = []  # (node_name, base_folder, newest_file)
if scene.use_nodes and scene.node_tree:
    for node in scene.node_tree.nodes:
        if node.type == "OUTPUT_FILE":
            base = bpy.path.abspath(node.base_path)
            f = newest_image_in(base)
            if f:
                produced.append((node.name, base, f))
if produced:
    print("KF: compositor outputs:", [p[0] for p in produced])

# Pick the one to send back to the portal (default: the "overlay" branded one).
prefer = (env("KF_OUTPUT_PREFER", "overlay") or "overlay").lower()
chosen = None
for name, base, f in produced:
    if prefer in (name + " " + base).lower():
        chosen = f
        break
if not chosen and produced:
    chosen = produced[0][2]

out_path = env("KF_OUTPUT")
if chosen:
    print("KF: returning finished image:", chosen)
    img = bpy.data.images.load(chosen, check_existing=False)
    img.filepath_raw = out_path
    img.file_format = "PNG"
    img.save()
else:
    print("KF: no compositor output found - returning raw render result")
    bpy.data.images["Render Result"].save_render(filepath=out_path)

# 7. Archive each produced file under a unique name so a new render never
#    overwrites the previous one on disk (the .blend always writes "Image0001").
stamp = time.strftime("%Y%m%d-%H%M%S")
label = slugify(env("KF_LABEL", "")) or "render"
jobid = (env("KF_JOB_ID", "") or "")[:6]
tag = "_".join(x for x in [label, stamp, jobid] if x)
for name, base, f in produced:
    ext = os.path.splitext(f)[1]
    dest = os.path.join(os.path.dirname(f), tag + ext)
    if os.path.abspath(dest) != os.path.abspath(f):
        try:
            os.replace(f, dest)
            print("KF: archived", name, "->", dest)
        except OSError as e:
            print("KF: could not archive", f, "-", e)

print("KF_RENDER_OK")
