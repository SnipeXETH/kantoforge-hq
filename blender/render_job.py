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
    print("KF: WARNING — these images did not load (render may look wrong):")
    for name, path in missing:
        print("   -", name, "->", path)

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

# 5. Render the current frame and save it exactly where the agent asked.
bpy.ops.render.render()
bpy.data.images["Render Result"].save_render(filepath=env("KF_OUTPUT"))
print("KF_RENDER_OK")
