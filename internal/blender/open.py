# Meld's Open in Blender (#290) runs this as Blender starts, on a client model it exported:
#   blender --python open.py -- <model.glb> <model.blend>
# It empties the startup scene, imports the model, saves it as the .blend beside the export (so Ctrl+S
# saves there) and frames it in the 3D view.
import sys

import bpy


def frame_model():
	"""Frames the imported model in each 3D view, once the window is up."""
	try:
		for window in bpy.context.window_manager.windows:
			for area in window.screen.areas:
				if area.type != 'VIEW_3D':
					continue
				region = next((r for r in area.regions if r.type == 'WINDOW'), None)
				if region is None:
					continue
				with bpy.context.temp_override(window=window, area=area, region=region):
					bpy.ops.view3d.view_selected()
	except Exception as e:  # framing is a nicety: never fail the import over it
		print('Meld: could not frame the model:', e)
	return None


def main():
	argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
	if len(argv) < 2:
		print('Meld: usage: blender --python open.py -- <model.glb> <model.blend>')
		return
	glb, blend = argv[0], argv[1]
	for o in list(bpy.data.objects):
		bpy.data.objects.remove(o, do_unlink=True)
	bpy.ops.import_scene.gltf(filepath=glb)
	bpy.ops.wm.save_as_mainfile(filepath=blend)
	if not bpy.app.background:
		bpy.app.timers.register(frame_model, first_interval=0.5)


main()
