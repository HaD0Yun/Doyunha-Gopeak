@tool
extends Node
class_name MCPScene3DTools

var _editor_plugin: EditorPlugin = null

func set_editor_plugin(plugin: EditorPlugin) -> void:
	_editor_plugin = plugin


func _refresh_and_reload(scene_path: String) -> void:
	_refresh_filesystem()
	_reload_scene_in_editor(scene_path)


func _refresh_filesystem() -> void:
	if _editor_plugin:
		_editor_plugin.get_editor_interface().get_resource_filesystem().scan()


func _reload_scene_in_editor(scene_path: String) -> void:
	if not _editor_plugin:
		return
	var ei := _editor_plugin.get_editor_interface()
	var edited := ei.get_edited_scene_root()
	if edited and edited.scene_file_path == scene_path:
		ei.reload_scene_from_path(scene_path)


func _ensure_res_path(path: String) -> String:
	if not path.begins_with("res://"):
		return "res://" + path
	return path


func _to_scene_res_path(project_path: String, scene_path: String) -> String:
	var p := scene_path.strip_edges()
	if p.begins_with("res://"):
		return p

	if project_path.strip_edges() != "":
		var normalized_project := project_path.replace("\\", "/")
		var normalized_scene := p.replace("\\", "/")
		if normalized_scene.begins_with(normalized_project):
			var rel := normalized_scene.substr(normalized_project.length())
			if rel.begins_with("/"):
				rel = rel.substr(1)
			return _ensure_res_path(rel)

	return _ensure_res_path(p)


func _load_scene(scene_path: String) -> Array:
	if not FileAccess.file_exists(scene_path):
		return [null, {"ok": false, "error": "Scene not found: " + scene_path}]
	var packed := load(scene_path) as PackedScene
	if not packed:
		return [null, {"ok": false, "error": "Failed to load: " + scene_path}]
	var root := packed.instantiate()
	if not root:
		return [null, {"ok": false, "error": "Failed to instantiate: " + scene_path}]
	return [root, {}]


func _save_scene(scene_root: Node, scene_path: String) -> Dictionary:
	var packed := PackedScene.new()
	if packed.pack(scene_root) != OK:
		scene_root.queue_free()
		return {"ok": false, "error": "Failed to pack scene"}
	if ResourceSaver.save(packed, scene_path) != OK:
		scene_root.queue_free()
		return {"ok": false, "error": "Failed to save scene"}
	scene_root.queue_free()
	_refresh_and_reload(scene_path)
	return {}


func _find_node(root: Node, path: String) -> Node:
	if path == "." or path.is_empty():
		return root
	return root.get_node_or_null(path)


func _parse_value(value, expected_type: int = TYPE_NIL):
	if typeof(value) == TYPE_DICTIONARY:
		var type_tag := ""
		if value.has("type"):
			type_tag = str(value["type"])
		elif value.has("_type"):
			type_tag = str(value["_type"])

		if not type_tag.is_empty():
			match type_tag:
				"Vector2":
					return Vector2(value.get("x", 0), value.get("y", 0))
				"Vector3":
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Color":
					return Color(value.get("r", 1), value.get("g", 1), value.get("b", 1), value.get("a", 1))
				"Vector2i":
					return Vector2i(value.get("x", 0), value.get("y", 0))
				"Vector3i":
					return Vector3i(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Rect2":
					return Rect2(value.get("x", 0), value.get("y", 0), value.get("width", 0), value.get("height", 0))
				"Transform2D":
					if value.has("x") and value.has("y") and value.has("origin"):
						var xx: Dictionary = value["x"]
						var yy: Dictionary = value["y"]
						var oo: Dictionary = value["origin"]
						return Transform2D(
							Vector2(xx.get("x", 1), xx.get("y", 0)),
							Vector2(yy.get("x", 0), yy.get("y", 1)),
							Vector2(oo.get("x", 0), oo.get("y", 0))
						)
				"Transform3D":
					if value.has("basis") and value.has("origin"):
						var b: Dictionary = value["basis"]
						var o: Dictionary = value["origin"]
						var basis := Basis(
							Vector3(b.get("x", {}).get("x", 1), b.get("x", {}).get("y", 0), b.get("x", {}).get("z", 0)),
							Vector3(b.get("y", {}).get("x", 0), b.get("y", {}).get("y", 1), b.get("y", {}).get("z", 0)),
							Vector3(b.get("z", {}).get("x", 0), b.get("z", {}).get("y", 0), b.get("z", {}).get("z", 1))
						)
						return Transform3D(basis, Vector3(o.get("x", 0), o.get("y", 0), o.get("z", 0)))
				"NodePath":
					return NodePath(value.get("path", ""))
				"Resource":
					var resource_path: String = str(value.get("path", ""))
					if resource_path.is_empty():
						return null
					return load(resource_path)

		match expected_type:
			TYPE_VECTOR2:
				if value.has("x") and value.has("y"):
					return Vector2(value.get("x", 0), value.get("y", 0))
			TYPE_VECTOR2I:
				if value.has("x") and value.has("y"):
					return Vector2i(value.get("x", 0), value.get("y", 0))
			TYPE_VECTOR3:
				if value.has("x") and value.has("y") and value.has("z"):
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
			TYPE_VECTOR3I:
				if value.has("x") and value.has("y") and value.has("z"):
					return Vector3i(value.get("x", 0), value.get("y", 0), value.get("z", 0))
			TYPE_COLOR:
				if value.has("r") and value.has("g") and value.has("b"):
					return Color(value.get("r", 1), value.get("g", 1), value.get("b", 1), value.get("a", 1))
			TYPE_RECT2:
				if value.has("x") and value.has("y") and value.has("width") and value.has("height"):
					return Rect2(value.get("x", 0), value.get("y", 0), value.get("width", 0), value.get("height", 0))
			TYPE_NODE_PATH:
				if value.has("path"):
					return NodePath(value.get("path", ""))
	if typeof(value) == TYPE_ARRAY:
		match expected_type:
			TYPE_VECTOR2:
				if value.size() >= 2:
					return Vector2(value[0], value[1])
			TYPE_VECTOR2I:
				if value.size() >= 2:
					return Vector2i(value[0], value[1])
			TYPE_VECTOR3:
				if value.size() >= 3:
					return Vector3(value[0], value[1], value[2])
			TYPE_VECTOR3I:
				if value.size() >= 3:
					return Vector3i(value[0], value[1], value[2])
		var result: Array = []
		for item in value:
			result.append(_parse_value(item))
		return result
	return value


func _get_property_type(node: Node, prop_name: String) -> int:
	for prop in node.get_property_list():
		if str(prop.get("name", "")) == prop_name:
			return int(prop.get("type", TYPE_NIL))
	return TYPE_NIL


func _serialize_value(value) -> Variant:
	match typeof(value):
		TYPE_VECTOR2:
			return {"type": "Vector2", "x": value.x, "y": value.y}
		TYPE_VECTOR3:
			return {"type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
		TYPE_COLOR:
			return {"type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
		TYPE_VECTOR2I:
			return {"type": "Vector2i", "x": value.x, "y": value.y}
		TYPE_VECTOR3I:
			return {"type": "Vector3i", "x": value.x, "y": value.y, "z": value.z}
		TYPE_RECT2:
			return {"type": "Rect2", "x": value.position.x, "y": value.position.y, "width": value.size.x, "height": value.size.y}
		TYPE_NODE_PATH:
			return {"type": "NodePath", "path": str(value)}
		TYPE_TRANSFORM2D:
			return {
				"type": "Transform2D",
				"x": {"x": value.x.x, "y": value.x.y},
				"y": {"x": value.y.x, "y": value.y.y},
				"origin": {"x": value.origin.x, "y": value.origin.y}
			}
		TYPE_TRANSFORM3D:
			return {
				"type": "Transform3D",
				"basis": {
					"x": {"x": value.basis.x.x, "y": value.basis.x.y, "z": value.basis.x.z},
					"y": {"x": value.basis.y.x, "y": value.basis.y.y, "z": value.basis.y.z},
					"z": {"x": value.basis.z.x, "y": value.basis.z.y, "z": value.basis.z.z}
				},
				"origin": {"x": value.origin.x, "y": value.origin.y, "z": value.origin.z}
			}
		TYPE_OBJECT:
			if value and value is Resource and value.resource_path:
				return {"type": "Resource", "path": value.resource_path}
			return null
		_:
			return value


func _set_node_properties(node: Node, properties: Dictionary) -> void:
	for prop_name in properties:
		var expected_type := _get_property_type(node, str(prop_name))
		var val = _parse_value(properties[prop_name], expected_type)
		node.set(prop_name, val)


func _parse_properties_arg(raw_properties) -> Dictionary:
	if typeof(raw_properties) == TYPE_DICTIONARY:
		return raw_properties
	if typeof(raw_properties) == TYPE_STRING:
		var text := String(raw_properties)
		if text.strip_edges().is_empty():
			return {}
		var parsed = JSON.parse_string(text)
		if typeof(parsed) == TYPE_DICTIONARY:
			return parsed
	return {}


func _ensure_parent_dir_for_scene(scene_path: String) -> void:
	var base_dir := scene_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(base_dir):
		DirAccess.make_dir_recursive_absolute(base_dir)


func _set_owner_recursive(node: Node, scene_owner: Node) -> void:
	node.owner = scene_owner
	for child in node.get_children():
		if child is Node:
			_set_owner_recursive(child as Node, scene_owner)


func add_mesh_instance(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var mesh_type := str(args.get("meshType", ""))
	var custom_mesh_path := str(args.get("customMeshPath", ""))
	var material_path := str(args.get("materialPath", ""))
	var radius: float = float(args.get("radius", 0.0))
	var height: float = float(args.get("height", 0.0))

	var raw_size = args.get("size", null)
	var size_vec: Vector3
	if raw_size != null:
		var parsed = _parse_value(raw_size, TYPE_VECTOR3)
		size_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3(1.0, 1.0, 1.0)
	else:
		size_vec = Vector3(1.0, 1.0, 1.0)

	var raw_position = args.get("position", null)
	var position_vec: Vector3
	if raw_position != null:
		var parsed = _parse_value(raw_position, TYPE_VECTOR3)
		position_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ZERO
	else:
		position_vec = Vector3.ZERO

	var raw_rotation = args.get("rotation", null)
	var rotation_vec: Vector3
	if raw_rotation != null:
		var parsed = _parse_value(raw_rotation, TYPE_VECTOR3)
		rotation_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ZERO
	else:
		rotation_vec = Vector3.ZERO

	var raw_scale = args.get("scale", null)
	var scale_vec: Vector3
	if raw_scale != null:
		var parsed = _parse_value(raw_scale, TYPE_VECTOR3)
		scale_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ONE
	else:
		scale_vec = Vector3.ONE

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}
	if mesh_type.is_empty():
		return {"ok": false, "error": "Missing meshType"}
	if mesh_type == "custom" and custom_mesh_path.is_empty():
		return {"ok": false, "error": "Missing customMeshPath for custom meshType"}

	var valid_mesh_types := ["box", "sphere", "cylinder", "plane", "capsule", "prism", "torus", "custom"]
	if not mesh_type in valid_mesh_types:
		return {"ok": false, "error": "Unknown meshType: " + mesh_type}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name

	var mesh: Mesh
	match mesh_type:
		"box":
			var m := BoxMesh.new()
			m.size = size_vec
			mesh = m
		"sphere":
			var m := SphereMesh.new()
			m.radius = radius if radius > 0.0 else 0.5
			m.height = height if height > 0.0 else 1.0
			mesh = m
		"cylinder":
			var m := CylinderMesh.new()
			m.top_radius = radius if radius > 0.0 else 0.5
			m.bottom_radius = m.top_radius
			m.height = height if height > 0.0 else 2.0
			mesh = m
		"plane":
			var m := PlaneMesh.new()
			if raw_size != null:
				m.size = Vector2(size_vec.x, size_vec.z)
			else:
				m.size = Vector2(2.0, 2.0)
			mesh = m
		"capsule":
			var m := CapsuleMesh.new()
			m.radius = radius if radius > 0.0 else 0.5
			m.height = height if height > 0.0 else 2.0
			mesh = m
		"prism":
			var m := PrismMesh.new()
			m.size = size_vec
			mesh = m
		"torus":
			var m := TorusMesh.new()
			var inner: float = radius if radius > 0.0 else 0.4
			# outer is 2× inner so the torus has a visible tube by default
			m.inner_radius = inner
			m.outer_radius = inner * 2.0
			mesh = m
		"custom":
			var loaded = load(_ensure_res_path(custom_mesh_path))
			if not loaded is Mesh:
				root.queue_free()
				return {"ok": false, "error": "customMeshPath did not load a Mesh resource: " + custom_mesh_path}
			mesh = loaded as Mesh

	mesh_instance.mesh = mesh

	if not material_path.is_empty():
		var mat = load(_ensure_res_path(material_path))
		if not mat is Material:
			root.queue_free()
			return {"ok": false, "error": "materialPath did not load a Material resource: " + material_path}
		mesh_instance.set_surface_override_material(0, mat as Material)

	mesh_instance.position = position_vec
	mesh_instance.rotation_degrees = rotation_vec
	if scale_vec != Vector3.ZERO:
		mesh_instance.scale = scale_vec

	parent.add_child(mesh_instance)
	_set_owner_recursive(mesh_instance, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": "MeshInstance3D", "meshType": mesh_type}


func setup_camera_3d(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))

	var raw_position = args.get("position", null)
	var position_vec: Vector3
	if raw_position != null:
		var parsed = _parse_value(raw_position, TYPE_VECTOR3)
		position_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ZERO
	else:
		position_vec = Vector3.ZERO

	var raw_target = args.get("target", null)
	var target_vec: Vector3
	var has_target := false
	if raw_target != null:
		var parsed = _parse_value(raw_target, TYPE_VECTOR3)
		if typeof(parsed) == TYPE_VECTOR3:
			target_vec = parsed
			has_target = true

	var fov: float = float(args.get("fov", 0.0))
	var near: float = float(args.get("near", 0.0))
	var far: float = float(args.get("far", 0.0))
	var size: float = float(args.get("size", 0.0))
	var projection_str := str(args.get("projection", ""))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}

	if not projection_str.is_empty():
		var valid_projections := ["perspective", "orthogonal"]
		if not projection_str in valid_projections:
			return {"ok": false, "error": "Invalid projection: " + projection_str + ". Must be 'perspective' or 'orthogonal'"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var camera := Camera3D.new()
	camera.name = node_name

	camera.position = position_vec

	if projection_str == "orthogonal":
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	elif projection_str == "perspective":
		camera.projection = Camera3D.PROJECTION_PERSPECTIVE

	if fov > 0.0:
		camera.fov = fov
	if near > 0.0:
		camera.near = near
	if far > 0.0:
		camera.far = far
	if size > 0.0:
		camera.size = size
	if args.has("current"):
		camera.current = bool(args.get("current"))

	parent.add_child(camera)
	_set_owner_recursive(camera, root)

	if has_target:
		var dist := camera.global_position.distance_to(target_vec)
		if dist >= 0.0001:
			var direction := (target_vec - camera.global_position).normalized()
			var up_vector: Vector3
			if abs(direction.dot(Vector3.UP)) > 0.999:
				up_vector = Vector3.BACK
			else:
				up_vector = Vector3.UP
			camera.look_at(target_vec, up_vector)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": "Camera3D"}


func setup_lighting(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var light_type := str(args.get("lightType", ""))

	var raw_position = args.get("position", null)
	var position_vec: Vector3
	if raw_position != null:
		var parsed = _parse_value(raw_position, TYPE_VECTOR3)
		position_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ZERO
	else:
		position_vec = Vector3.ZERO

	var raw_rotation = args.get("rotation", null)
	var rotation_vec: Vector3
	if raw_rotation != null:
		var parsed = _parse_value(raw_rotation, TYPE_VECTOR3)
		rotation_vec = parsed if typeof(parsed) == TYPE_VECTOR3 else Vector3.ZERO
	else:
		rotation_vec = Vector3.ZERO

	var raw_color = args.get("color", null)
	var color_val: Color
	var has_color := false
	if raw_color != null:
		var parsed = _parse_value(raw_color, TYPE_COLOR)
		if typeof(parsed) == TYPE_COLOR:
			color_val = parsed
			has_color = true

	var energy: float = float(args.get("energy", 0.0))
	var range_val: float = float(args.get("range", 0.0))
	var spot_angle: float = float(args.get("spotAngle", 0.0))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}

	var valid_light_types := ["directional", "omni", "spot"]
	if not light_type in valid_light_types:
		return {"ok": false, "error": "Invalid lightType: " + light_type + ". Must be 'directional', 'omni', or 'spot'"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var light: Light3D
	var class_name_str: String
	match light_type:
		"directional":
			light = DirectionalLight3D.new()
			class_name_str = "DirectionalLight3D"
		"omni":
			light = OmniLight3D.new()
			class_name_str = "OmniLight3D"
		"spot":
			light = SpotLight3D.new()
			class_name_str = "SpotLight3D"

	light.name = node_name

	if has_color:
		light.light_color = color_val
	if energy > 0.0:
		light.light_energy = energy
	if args.has("shadowEnabled"):
		light.shadow_enabled = bool(args.get("shadowEnabled"))

	light.position = position_vec
	light.rotation_degrees = rotation_vec

	if light_type == "omni":
		if range_val > 0.0:
			(light as OmniLight3D).omni_range = range_val
	elif light_type == "spot":
		if range_val > 0.0:
			(light as SpotLight3D).spot_range = range_val
		if spot_angle > 0.0:
			(light as SpotLight3D).spot_angle = spot_angle

	parent.add_child(light)
	_set_owner_recursive(light, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": class_name_str, "lightType": light_type}


func setup_environment(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	if node_name.is_empty():
		node_name = "WorldEnvironment"

	var background_mode := str(args.get("backgroundMode", ""))
	var valid_bg_modes := ["clear_color", "color", "sky", "canvas"]
	if not background_mode.is_empty() and not background_mode in valid_bg_modes:
		return {"ok": false, "error": "Invalid backgroundMode: " + background_mode + ". Must be one of: clear_color, color, sky, canvas"}

	var raw_bg_color = args.get("backgroundColor", null)
	var bg_color_val: Color
	var has_bg_color := false
	if raw_bg_color != null:
		var parsed = _parse_value(raw_bg_color, TYPE_COLOR)
		if typeof(parsed) == TYPE_COLOR:
			bg_color_val = parsed
			has_bg_color = true

	var raw_ambient_color = args.get("ambientLightColor", null)
	var ambient_color_val: Color
	var has_ambient_color := false
	if raw_ambient_color != null:
		var parsed = _parse_value(raw_ambient_color, TYPE_COLOR)
		if typeof(parsed) == TYPE_COLOR:
			ambient_color_val = parsed
			has_ambient_color = true

	var ambient_energy: float = float(args.get("ambientLightEnergy", 0.0))
	var fog_density: float = float(args.get("fogDensity", 0.0))
	var env_resource_path := str(args.get("environmentResourcePath", ""))

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var world_env := WorldEnvironment.new()
	world_env.name = node_name

	var used_existing_resource := false

	if not env_resource_path.is_empty():
		var loaded = load(_ensure_res_path(env_resource_path))
		if not loaded is Environment:
			root.queue_free()
			return {"ok": false, "error": "environmentResourcePath did not load an Environment resource: " + env_resource_path}
		world_env.environment = loaded as Environment
		used_existing_resource = true
	else:
		var env := Environment.new()

		if not background_mode.is_empty():
			match background_mode:
				"clear_color":
					env.background_mode = Environment.BG_CLEAR_COLOR
				"color":
					env.background_mode = Environment.BG_COLOR
				"sky":
					env.background_mode = Environment.BG_SKY
					var sky := Sky.new()
					sky.sky_material = ProceduralSkyMaterial.new()
					env.sky = sky
				"canvas":
					env.background_mode = Environment.BG_CANVAS

		if has_bg_color:
			env.background_color = bg_color_val
		if has_ambient_color:
			env.ambient_light_color = ambient_color_val
		if ambient_energy > 0.0:
			env.ambient_light_energy = ambient_energy
		if args.has("glowEnabled"):
			env.glow_enabled = bool(args.get("glowEnabled"))
		if args.has("fogEnabled"):
			env.fog_enabled = bool(args.get("fogEnabled"))
		if fog_density > 0.0:
			env.fog_density = fog_density

		world_env.environment = env

	parent.add_child(world_env)
	_set_owner_recursive(world_env, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": "WorldEnvironment", "usedExistingResource": used_existing_resource}


func set_material_3d(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))
	var surface_index: int = int(args.get("surfaceIndex", 0))
	var material_path := str(args.get("materialPath", ""))
	var save_as_resource_path := str(args.get("saveAsResourcePath", ""))
	var props_raw = args.get("materialProperties", null)
	var props_dict := _parse_properties_arg(props_raw)

	if node_path.is_empty():
		return {"ok": false, "error": "Missing nodePath"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var target := _find_node(root, node_path)
	if not target:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	if not target is GeometryInstance3D:
		root.queue_free()
		return {"ok": false, "error": "Node is not a GeometryInstance3D: " + node_path}

	var material: Material

	if props_dict.size() > 0:
		# Build or mutate a StandardMaterial3D
		var mat: StandardMaterial3D
		if not material_path.is_empty():
			var loaded = load(_ensure_res_path(material_path))
			if loaded is StandardMaterial3D:
				mat = (loaded as StandardMaterial3D).duplicate() as StandardMaterial3D
			else:
				mat = StandardMaterial3D.new()
		else:
			mat = StandardMaterial3D.new()

		if props_dict.has("albedoColor"):
			var parsed = _parse_value(props_dict["albedoColor"], TYPE_COLOR)
			if typeof(parsed) == TYPE_COLOR:
				mat.albedo_color = parsed

		if props_dict.has("metallic"):
			mat.metallic = float(props_dict["metallic"])

		if props_dict.has("roughness"):
			mat.roughness = float(props_dict["roughness"])

		if props_dict.has("emission"):
			var parsed = _parse_value(props_dict["emission"], TYPE_COLOR)
			if typeof(parsed) == TYPE_COLOR:
				mat.emission_enabled = true
				mat.emission = parsed

		if props_dict.has("emissionEnergy"):
			mat.emission_energy_multiplier = float(props_dict["emissionEnergy"])

		if props_dict.has("albedoTexturePath"):
			var tex_path := _ensure_res_path(str(props_dict["albedoTexturePath"]))
			var loaded = load(tex_path)
			if not loaded is Texture2D:
				root.queue_free()
				return {"ok": false, "error": "albedoTexturePath did not load a Texture2D: " + str(props_dict["albedoTexturePath"])}
			mat.albedo_texture = loaded as Texture2D

		if props_dict.has("normalTexturePath"):
			var tex_path := _ensure_res_path(str(props_dict["normalTexturePath"]))
			var loaded = load(tex_path)
			if not loaded is Texture2D:
				root.queue_free()
				return {"ok": false, "error": "normalTexturePath did not load a Texture2D: " + str(props_dict["normalTexturePath"])}
			mat.normal_enabled = true
			mat.normal_texture = loaded as Texture2D

		material = mat

	elif not material_path.is_empty():
		var loaded = load(_ensure_res_path(material_path))
		if not loaded is Material:
			root.queue_free()
			return {"ok": false, "error": "materialPath did not load a Material resource: " + material_path}
		material = loaded as Material

	else:
		root.queue_free()
		return {"ok": false, "error": "Provide materialPath or materialProperties"}

	var save_path := ""
	if not save_as_resource_path.is_empty():
		save_path = _ensure_res_path(save_as_resource_path)
		_ensure_parent_dir_for_scene(save_path)
		if ResourceSaver.save(material, save_path) != OK:
			root.queue_free()
			return {"ok": false, "error": "Failed to save material resource to: " + save_path}

	if surface_index == -1:
		(target as GeometryInstance3D).material_override = material
	elif surface_index >= 0:
		if not target is MeshInstance3D:
			root.queue_free()
			return {"ok": false, "error": "surfaceIndex >= 0 requires a MeshInstance3D node; pass surfaceIndex = -1 to use material_override on any GeometryInstance3D"}
		(target as MeshInstance3D).set_surface_override_material(surface_index, material)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"nodePath": node_path,
		"appliedTo": "material_override" if surface_index == -1 else ("surface_" + str(surface_index)),
		"savedAs": save_path if not save_as_resource_path.is_empty() else null,
	}


func add_gridmap(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var mesh_library_path := str(args.get("meshLibraryPath", ""))
	var cell_octant_size := int(args.get("cellOctantSize", 0))

	var raw_cell_size = args.get("cellSize", null)
	var cell_size_vec: Vector3
	var has_cell_size := false
	if raw_cell_size != null:
		var parsed = _parse_value(raw_cell_size, TYPE_VECTOR3)
		if typeof(parsed) == TYPE_VECTOR3:
			cell_size_vec = parsed
			has_cell_size = true

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}

	if not ClassDB.class_exists("GridMap"):
		return {"ok": false, "error": "GridMap class is not available — enable the gridmap module"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var gridmap := GridMap.new()
	gridmap.name = node_name

	if has_cell_size:
		gridmap.cell_size = cell_size_vec

	if cell_octant_size > 0:
		gridmap.cell_octant_size = cell_octant_size

	if not mesh_library_path.is_empty():
		var loaded = load(_ensure_res_path(mesh_library_path))
		if not loaded is MeshLibrary:
			root.queue_free()
			return {"ok": false, "error": "meshLibraryPath did not load a MeshLibrary resource: " + mesh_library_path}
		gridmap.mesh_library = loaded as MeshLibrary

	parent.add_child(gridmap)
	_set_owner_recursive(gridmap, root)

	var cells_set_count := 0
	var cells_raw = args.get("cells", null)
	if typeof(cells_raw) == TYPE_ARRAY:
		for cell in cells_raw:
			if typeof(cell) != TYPE_DICTIONARY:
				continue
			var cx := int(cell.get("x", 0))
			var cy := int(cell.get("y", 0))
			var cz := int(cell.get("z", 0))
			var item := int(cell.get("item", -1))
			var orientation := int(cell.get("orientation", 0))
			gridmap.set_cell_item(Vector3i(cx, cy, cz), item, orientation)
			cells_set_count += 1

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"nodeName": node_name,
		"nodeType": "GridMap",
		"cellsSet": cells_set_count,
		"hasMeshLibrary": not mesh_library_path.is_empty(),
	}
