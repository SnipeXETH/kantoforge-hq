# Runs INSIDE Blender:  blender -b your-template.blend -P render_job.py
#
# Swaps the card and background-artwork images for the ones the agent supplies,
# then renders a still to the output path. Everything is passed via environment
# variables (the agent sets them). It swaps by Image *datablock name* — the most
# reliable method — so you just need the two image names from your .blend.
#
# To find the names: in Blender open the "Blender File" view in the Outliner
# (top-right dropdown) and expand "Images", or open the Image Editor and look at
# the image dropdown. Put those two names in the agent's .env.

import bpy
import os


def swap(image_name, new_path):
    img = bpy.data.images.get(image_name)
    if img is None:
        names = [i.name for i in bpy.data.images]
        raise SystemExit(
            "Image datablock '%s' not found. Available images: %s" % (image_name, names)
        )
    img.filepath = new_path
    img.source = "FILE"
    img.reload()


swap(os.environ["KF_CARD_IMG_NAME"], os.environ["KF_CARD_FILE"])
swap(os.environ["KF_ART_IMG_NAME"], os.environ["KF_ART_FILE"])

scene = bpy.context.scene
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = os.environ["KF_OUTPUT"]

# Optional overrides
if os.environ.get("KF_RES_X"):
    scene.render.resolution_x = int(os.environ["KF_RES_X"])
if os.environ.get("KF_RES_Y"):
    scene.render.resolution_y = int(os.environ["KF_RES_Y"])
scene.render.resolution_percentage = 100

bpy.ops.render.render(write_still=True)
print("KF_RENDER_OK")
