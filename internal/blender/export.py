# Meld's Import from Blender (#290) runs this in a background Blender on the user's .blend:
#   blender -b <model.blend> --python export.py -- <model.glb>
# It exports the scene's visible meshes as a binary glTF (GLB), modifiers applied, without animation,
# skins, cameras or lights, for Meld to turn into a client model.
import sys

import bpy


def main():
	argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
	if len(argv) < 1:
		raise SystemExit('Meld: usage: blender -b <model.blend> --python export.py -- <model.glb>')
	out = argv[0]
	options = dict(
		filepath=out,
		export_format='GLB',
		export_apply=True,
		use_visible=True,
		export_animations=False,
		export_skins=False,
		export_morph=False,
		export_cameras=False,
		export_lights=False,
	)
	try:
		bpy.ops.export_scene.gltf(**options)
	except TypeError as e:
		# An option this Blender's exporter doesn't know: the plain export.
		print('Meld: exporting with the defaults:', e)
		bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')


main()
