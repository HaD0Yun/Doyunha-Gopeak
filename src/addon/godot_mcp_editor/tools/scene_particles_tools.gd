@tool
extends Node
class_name MCPSceneParticlesTools

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
	if scene_path.strip_edges().is_empty():
		return [null, {"ok": false, "error": "Missing scenePath"}]
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


func _set_node_properties(node: Node, properties: Dictionary) -> void:
	for prop_name in properties:
		var expected_type := _get_property_type(node, str(prop_name))
		var val = _parse_value(properties[prop_name], expected_type)
		node.set(prop_name, val)


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
		TYPE_OBJECT:
			if value and value is Resource and value.resource_path:
				return {"type": "Resource", "path": value.resource_path}
			return null
		_:
			return value


func _set_owner_recursive(node: Node, scene_owner: Node) -> void:
	node.owner = scene_owner
	for child in node.get_children():
		if child is Node:
			_set_owner_recursive(child as Node, scene_owner)


func _ensure_parent_dir_for_scene(scene_path: String) -> void:
	var base_dir := scene_path.get_base_dir()
	if not DirAccess.dir_exists_absolute(base_dir):
		DirAccess.make_dir_recursive_absolute(base_dir)


func create_particles(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var particle_type := str(args.get("particleType", ""))
	var emission_shape := str(args.get("emissionShape", ""))
	var amount := int(args.get("amount", 100))
	var lifetime := float(args.get("lifetime", 1.0))
	var explosiveness := float(args.get("explosiveness", 0.0))
	var process_material_path := str(args.get("processMaterialPath", ""))
	var draw_pass_path := str(args.get("drawPassPath", ""))

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

	var raw_direction = args.get("direction", null)
	var direction_vec: Vector3
	var has_direction := false
	if raw_direction != null:
		var parsed = _parse_value(raw_direction, TYPE_VECTOR3)
		if typeof(parsed) == TYPE_VECTOR3:
			direction_vec = parsed
			has_direction = true

	var raw_gravity = args.get("gravity", null)
	var gravity_vec: Vector3
	var has_gravity := false
	if raw_gravity != null:
		var parsed = _parse_value(raw_gravity, TYPE_VECTOR3)
		if typeof(parsed) == TYPE_VECTOR3:
			gravity_vec = parsed
			has_gravity = true

	var raw_spread = args.get("spread", null)
	var spread_val: float = 45.0
	if raw_spread != null:
		spread_val = float(raw_spread)

	var raw_initial_velocity = args.get("initialVelocity", null)
	var initial_vel_min: float = 0.0
	var initial_vel_max: float = 0.0
	var has_velocity := false
	if raw_initial_velocity != null:
		if typeof(raw_initial_velocity) == TYPE_FLOAT or typeof(raw_initial_velocity) == TYPE_INT:
			initial_vel_min = float(raw_initial_velocity)
			initial_vel_max = initial_vel_min
			has_velocity = true
		elif typeof(raw_initial_velocity) == TYPE_DICTIONARY:
			initial_vel_min = float(raw_initial_velocity.get("min", 0.0))
			initial_vel_max = float(raw_initial_velocity.get("max", 0.0))
			has_velocity = true

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}
	if particle_type.is_empty():
		return {"ok": false, "error": "Missing particleType"}

	var valid_particle_types := ["GPUParticles3D", "CPUParticles3D", "GPUParticles2D", "CPUParticles2D"]
	if not particle_type in valid_particle_types:
		return {"ok": false, "error": "Invalid particleType: " + particle_type + ". Must be one of: GPUParticles3D, CPUParticles3D, GPUParticles2D, CPUParticles2D"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var particles: Node
	var is_3d := false

	match particle_type:
		"GPUParticles3D":
			particles = GPUParticles3D.new()
			is_3d = true
		"CPUParticles3D":
			particles = CPUParticles3D.new()
			is_3d = true
		"GPUParticles2D":
			particles = GPUParticles2D.new()
		"CPUParticles2D":
			particles = CPUParticles2D.new()

	particles.name = node_name
	particles.amount = amount
	particles.lifetime = lifetime

	if args.has("explosiveness"):
		particles.explosiveness_ratio = explosiveness

	# Position and rotation - use Vector2 for 2D, Vector3 for 3D
	if is_3d:
		particles.position = position_vec
		particles.rotation_degrees = rotation_vec
	else:
		particles.position = Vector2(position_vec.x, position_vec.y)
		particles.rotation_degrees = Vector3(0, 0, rotation_vec.x).z  # Use x component as rotation for 2D

	# Determine if we should use process material or direct node properties
	var is_cpu_particles := particle_type.begins_with("CPUParticles")
	var use_process_material := not is_cpu_particles or process_material_path.is_empty()

	# Create process material for GPUParticles or when explicitly provided
	var proc_mat: ParticleProcessMaterial = null
	if use_process_material:
		if not process_material_path.is_empty():
			var loaded = load(_ensure_res_path(process_material_path))
			if loaded is ParticleProcessMaterial:
				proc_mat = loaded as ParticleProcessMaterial
			else:
				root.queue_free()
				return {"ok": false, "error": "processMaterialPath did not load a ParticleProcessMaterial: " + process_material_path}
		else:
			proc_mat = ParticleProcessMaterial.new()

		# Configure emission shape
		if not emission_shape.is_empty():
			var valid_shapes := ["sphere", "box", "ring", "point"]
			if not emission_shape in valid_shapes:
				root.queue_free()
				return {"ok": false, "error": "Invalid emissionShape: " + emission_shape}
			match emission_shape:
				"sphere":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
				"box":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
				"ring":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
				"point":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_POINT

		# Direction settings
		if has_direction:
			proc_mat.direction = direction_vec
		proc_mat.spread = spread_val

		# Initial velocity
		if has_velocity:
			proc_mat.initial_velocity_min = initial_vel_min
			proc_mat.initial_velocity_max = initial_vel_max

		# Gravity
		if has_gravity:
			proc_mat.gravity = gravity_vec

		# Apply to particles (GPUParticles only, or CPUParticles with explicit material path)
		if particles is GPUParticles3D:
			(particles as GPUParticles3D).process_material = proc_mat
		elif particles is GPUParticles2D:
			(particles as GPUParticles2D).process_material = proc_mat
		elif is_cpu_particles and not process_material_path.is_empty():
			# CPUParticles can use a process material if explicitly provided
			if is_3d:
				(particles as CPUParticles3D).process_material = proc_mat
			else:
				(particles as CPUParticles2D).process_material = proc_mat

	# For CPUParticles without explicit process material, set direct node properties
	if is_cpu_particles and proc_mat == null:
		proc_mat = ParticleProcessMaterial.new()

		# Configure for CPUParticles
		if not emission_shape.is_empty():
			var valid_shapes := ["sphere", "box", "ring", "point"]
			if not emission_shape in valid_shapes:
				root.queue_free()
				return {"ok": false, "error": "Invalid emissionShape: " + emission_shape}
			match emission_shape:
				"sphere":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
				"box":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
				"ring":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_RING
				"point":
					proc_mat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_POINT

		if has_direction:
			proc_mat.direction = direction_vec
		proc_mat.spread = spread_val
		if has_velocity:
			proc_mat.initial_velocity_min = initial_vel_min
			proc_mat.initial_velocity_max = initial_vel_max
		if has_gravity:
			proc_mat.gravity = gravity_vec

		# CPUParticles use the same process_material property but apply properties to node directly
		if is_3d:
			(particles as CPUParticles3D).process_material = proc_mat
		else:
			(particles as CPUParticles2D).process_material = proc_mat

	# Draw pass - create a default box mesh for 3D particles
	if not draw_pass_path.is_empty():
		var loaded = load(_ensure_res_path(draw_pass_path))
		if is_3d and loaded is Mesh:
			(particles as GPUParticles3D).draw_pass_1 = loaded
		elif not is_3d and loaded is Texture2D:
			(particles as GPUParticles2D).texture = loaded
		else:
			root.queue_free()
			return {"ok": false, "error": "drawPassPath did not load a valid mesh or texture: " + draw_pass_path}

	parent.add_child(particles)
	_set_owner_recursive(particles, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": particle_type, "particleCount": amount, "lifetime": lifetime}


func set_particle_material(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))
	var process_material_path := str(args.get("processMaterialPath", ""))
	var props_raw = args.get("materialProperties", null)
	var save_as_resource_path := str(args.get("saveAsResourcePath", ""))

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

	# Check if target is a particle node
	var is_particles_3d := target is GPUParticles3D or target is CPUParticles3D
	var is_particles_2d := target is GPUParticles2D or target is CPUParticles2D
	if not is_particles_3d and not is_particles_2d:
		root.queue_free()
		return {"ok": false, "error": "Node is not a particle node (GPUParticles3D, CPUParticles3D, GPUParticles2D, CPUParticles2D): " + node_path}

	var proc_mat: ParticleProcessMaterial

	# Get existing material from target node if available
	var existing_mat = target.get("process_material")
	var target_is_cpu := target is CPUParticles3D or target is CPUParticles2D

	# Build or load material - prefer duplicating existing when no explicit path provided
	if not process_material_path.is_empty():
		var loaded = load(_ensure_res_path(process_material_path))
		if loaded is ParticleProcessMaterial:
			proc_mat = (loaded as ParticleProcessMaterial).duplicate() as ParticleProcessMaterial
		else:
			proc_mat = ParticleProcessMaterial.new()
	elif existing_mat is ParticleProcessMaterial:
		# Duplicate existing material for partial updates
		proc_mat = (existing_mat as ParticleProcessMaterial).duplicate() as ParticleProcessMaterial
	else:
		proc_mat = ParticleProcessMaterial.new()

	# Apply inline property overrides
	if typeof(props_raw) == TYPE_DICTIONARY:
		var props := props_raw as Dictionary

		# Color settings
		if props.has("color"):
			var parsed = _parse_value(props["color"], TYPE_COLOR)
			if typeof(parsed) == TYPE_COLOR:
				proc_mat.color = parsed

		if props.has("colorRamp"):
			var ramp_path := str(props["colorRamp"])
			if not ramp_path.is_empty():
				var loaded = load(_ensure_res_path(ramp_path))
				if loaded is GradientTexture1D:
					proc_mat.color_ramp = loaded as GradientTexture1D

		# Velocity settings
		if props.has("initialVelocityMin"):
			proc_mat.initial_velocity_min = float(props["initialVelocityMin"])
		if props.has("initialVelocityMax"):
			proc_mat.initial_velocity_max = float(props["initialVelocityMax"])

		# Gravity
		if props.has("gravity"):
			var parsed = _parse_value(props["gravity"], TYPE_VECTOR3)
			if typeof(parsed) == TYPE_VECTOR3:
				proc_mat.gravity = parsed

		# Acceleration
		if props.has("acceleration"):
			var parsed = _parse_value(props["acceleration"], TYPE_VECTOR3)
			if typeof(parsed) == TYPE_VECTOR3:
				proc_mat.acceleration = parsed

		# Damping
		if props.has("dampingMin"):
			proc_mat.damping_min = float(props["dampingMin"])
		if props.has("dampingMax"):
			proc_mat.damping_max = float(props["dampingMax"])
		if props.has("damping"):
			# Set both min and max if only damping provided
			var d := float(props["damping"])
			proc_mat.damping_min = d
			proc_mat.damping_max = d

		# Scale
		if props.has("scaleMin"):
			proc_mat.scale_min = float(props["scaleMin"])
		if props.has("scaleMax"):
			proc_mat.scale_max = float(props["scaleMax"])

		# Hue variation
		if props.has("hueVariationMin"):
			proc_mat.hue_variation_min = float(props["hueVariationMin"])
		if props.has("hueVariationMax"):
			proc_mat.hue_variation_max = float(props["hueVariationMax"])

		# Turbulence
		if props.has("turbulenceEnabled"):
			proc_mat.turbulence_enabled = bool(props["turbulenceEnabled"])
		if props.has("turbulenceNoiseStrength"):
			proc_mat.turbulence_noise_strength = float(props["turbulenceNoiseStrength"])

	# Save material as resource if path provided
	var save_path := ""
	if not save_as_resource_path.is_empty():
		save_path = _ensure_res_path(save_as_resource_path)
		_ensure_parent_dir_for_scene(save_path)
		if ResourceSaver.save(proc_mat, save_path) != OK:
			root.queue_free()
			return {"ok": false, "error": "Failed to save particle material to: " + save_path}

	# Apply to particles
	if is_particles_3d:
		if target is GPUParticles3D:
			(target as GPUParticles3D).process_material = proc_mat
		elif target is CPUParticles3D:
			(target as CPUParticles3D).process_material = proc_mat
	else:
		if target is GPUParticles2D:
			(target as GPUParticles2D).process_material = proc_mat
		elif target is CPUParticles2D:
			(target as CPUParticles2D).process_material = proc_mat

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"nodePath": node_path,
		"appliedTo": "processMaterial",
		"savedAs": save_path if not save_as_resource_path.is_empty() else null,
	}


func set_particle_color_gradient(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))
	var gradient_path := str(args.get("gradientPath", ""))
	var colors_raw = args.get("colors", null)
	var save_as_resource_path := str(args.get("saveAsResourcePath", ""))

	if node_path.is_empty():
		return {"ok": false, "error": "Missing nodePath"}
	if gradient_path.is_empty() and colors_raw == null:
		return {"ok": false, "error": "Provide either gradientPath or colors array"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var target := _find_node(root, node_path)
	if not target:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var is_particles_3d := target is GPUParticles3D or target is CPUParticles3D
	var is_particles_2d := target is GPUParticles2D or target is CPUParticles2D
	if not is_particles_3d and not is_particles_2d:
		root.queue_free()
		return {"ok": false, "error": "Node is not a particle node: " + node_path}

	var gradient: Gradient

	# Load or create gradient
	if not gradient_path.is_empty():
		var loaded = load(_ensure_res_path(gradient_path))
		if loaded is Gradient:
			gradient = (loaded as Gradient).duplicate() as Gradient
		else:
			gradient = Gradient.new()
	else:
		gradient = Gradient.new()

	# Build gradient from colors array
	if colors_raw != null and typeof(colors_raw) == TYPE_ARRAY:
		var colors_arr := colors_raw as Array
		var points: Array[float] = []
		var color_values: Array[Color] = []

		for i in range(colors_arr.size()):
			var item = colors_arr[i]
			if typeof(item) == TYPE_DICTIONARY:
				var pt: float = float(item.get("point", float(i) / float(max(colors_arr.size() - 1, 1))))
				var col: Color = Color.WHITE

				var col_raw = item.get("color", null)
				if col_raw != null:
					var parsed = _parse_value(col_raw, TYPE_COLOR)
					if typeof(parsed) == TYPE_COLOR:
						col = parsed

				points.append(pt)
				color_values.append(col)

		gradient.clear_points()
		for i in range(points.size()):
			gradient.add_point(points[i], color_values[i])

	# Create gradient texture
	var gradient_tex := GradientTexture1D.new()
	gradient_tex.gradient = gradient
	gradient_tex.width = 256

	# Apply to particles
	if is_particles_3d:
		var proc_mat: ParticleProcessMaterial
		if target is GPUParticles3D:
			proc_mat = (target as GPUParticles3D).process_material
		elif target is CPUParticles3D:
			proc_mat = (target as CPUParticles3D).process_material

		if proc_mat:
			proc_mat.color_ramp = gradient_tex
	else:
		var proc_mat: ParticleProcessMaterial
		if target is GPUParticles2D:
			proc_mat = (target as GPUParticles2D).process_material
		elif target is CPUParticles2D:
			proc_mat = (target as CPUParticles2D).process_material

		if proc_mat:
			proc_mat.color_ramp = gradient_tex

	# Save gradient as resource if path provided
	var save_path := ""
	if not save_as_resource_path.is_empty():
		save_path = _ensure_res_path(save_as_resource_path)
		_ensure_parent_dir_for_scene(save_path)
		if ResourceSaver.save(gradient_tex, save_path) != OK:
			root.queue_free()
			return {"ok": false, "error": "Failed to save gradient texture to: " + save_path}

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"nodePath": node_path,
		"appliedTo": "color_ramp",
		"gradientPoints": gradient.get_point_count() if gradient else 0,
		"savedAs": save_path if not save_as_resource_path.is_empty() else null,
	}


func apply_particle_preset(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var preset := str(args.get("preset", ""))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}
	if preset.is_empty():
		return {"ok": false, "error": "Missing preset"}

	# Preset configurations
	var preset_configs := {
		"fire": {
			"particleType": "CPUParticles3D",
			"amount": 100,
			"lifetime": 1.5,
			"emissionShape": "box",
			"spread": 30.0,
			"gravity": Vector3(0, 2, 0),
			"initialVelocityMin": 1.0,
			"initialVelocityMax": 3.0,
			"scaleMin": 0.3,
			"scaleMax": 0.8,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 0.3, "b": 0.0, "a": 0.0}},
				{"point": 0.3, "color": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0}},
				{"point": 0.7, "color": {"r": 1.0, "g": 0.2, "b": 0.0, "a": 0.8}},
				{"point": 1.0, "color": {"r": 0.2, "g": 0.0, "b": 0.0, "a": 0.0}},
			],
		},
		"smoke": {
			"particleType": "CPUParticles3D",
			"amount": 50,
			"lifetime": 3.0,
			"emissionShape": "box",
			"spread": 45.0,
			"gravity": Vector3(0, 1, 0),
			"initialVelocityMin": 0.5,
			"initialVelocityMax": 1.5,
			"scaleMin": 0.5,
			"scaleMax": 2.0,
			"colors": [
				{"point": 0.0, "color": {"r": 0.3, "g": 0.3, "b": 0.3, "a": 0.5}},
				{"point": 0.5, "color": {"r": 0.2, "g": 0.2, "b": 0.2, "a": 0.3}},
				{"point": 1.0, "color": {"r": 0.1, "g": 0.1, "b": 0.1, "a": 0.0}},
			],
		},
		"snow": {
			"particleType": "CPUParticles3D",
			"amount": 200,
			"lifetime": 5.0,
			"emissionShape": "box",
			"spread": 20.0,
			"gravity": Vector3(0, -1, 0),
			"initialVelocityMin": 0.5,
			"initialVelocityMax": 1.0,
			"scaleMin": 0.1,
			"scaleMax": 0.3,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 0.8}},
				{"point": 1.0, "color": {"r": 0.9, "g": 0.9, "b": 1.0, "a": 0.0}},
			],
		},
		"explosion": {
			"particleType": "CPUParticles3D",
			"amount": 150,
			"lifetime": 1.0,
			"emissionShape": "sphere",
			"spread": 180.0,
			"gravity": Vector3.ZERO,
			"initialVelocityMin": 5.0,
			"initialVelocityMax": 10.0,
			"explosiveness": 0.9,
			"scaleMin": 0.2,
			"scaleMax": 0.6,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 1.0, "b": 0.8, "a": 1.0}},
				{"point": 0.3, "color": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0}},
				{"point": 0.7, "color": {"r": 0.5, "g": 0.1, "b": 0.0, "a": 0.8}},
				{"point": 1.0, "color": {"r": 0.1, "g": 0.0, "b": 0.0, "a": 0.0}},
			],
		},
		"sparks": {
			"particleType": "CPUParticles3D",
			"amount": 50,
			"lifetime": 0.8,
			"emissionShape": "point",
			"spread": 60.0,
			"gravity": Vector3(0, -5, 0),
			"initialVelocityMin": 3.0,
			"initialVelocityMax": 6.0,
			"scaleMin": 0.05,
			"scaleMax": 0.15,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 0.9, "b": 0.5, "a": 1.0}},
				{"point": 0.5, "color": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0}},
				{"point": 1.0, "color": {"r": 0.5, "g": 0.2, "b": 0.0, "a": 0.0}},
			],
		},
		"rain": {
			"particleType": "CPUParticles3D",
			"amount": 500,
			"lifetime": 2.0,
			"emissionShape": "box",
			"spread": 5.0,
			"gravity": Vector3(0, -10, 0),
			"initialVelocityMin": 8.0,
			"initialVelocityMax": 10.0,
			"scaleMin": 0.1,
			"scaleMax": 0.2,
			"colors": [
				{"point": 0.0, "color": {"r": 0.5, "g": 0.6, "b": 0.8, "a": 0.6}},
				{"point": 1.0, "color": {"r": 0.4, "g": 0.5, "b": 0.7, "a": 0.0}},
			],
		},
		"magic_dust": {
			"particleType": "CPUParticles3D",
			"amount": 80,
			"lifetime": 4.0,
			"emissionShape": "sphere",
			"spread": 90.0,
			"gravity": Vector3(0, 0.2, 0),
			"initialVelocityMin": 0.2,
			"initialVelocityMax": 0.5,
			"hueVariationMin": -0.1,
			"hueVariationMax": 0.1,
			"scaleMin": 0.05,
			"scaleMax": 0.2,
			"colors": [
				{"point": 0.0, "color": {"r": 0.8, "g": 0.4, "b": 1.0, "a": 0.0}},
				{"point": 0.3, "color": {"r": 0.6, "g": 0.8, "b": 1.0, "a": 1.0}},
				{"point": 0.7, "color": {"r": 0.4, "g": 1.0, "b": 0.8, "a": 0.8}},
				{"point": 1.0, "color": {"r": 1.0, "g": 0.6, "b": 0.8, "a": 0.0}},
			],
		},
		"2d_fire": {
			"particleType": "CPUParticles2D",
			"amount": 100,
			"lifetime": 1.5,
			"emissionShape": "box",
			"spread": 30.0,
			"gravity": Vector2(0, 2),
			"initialVelocityMin": 1.0,
			"initialVelocityMax": 3.0,
			"scaleMin": 0.3,
			"scaleMax": 0.8,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 0.3, "b": 0.0, "a": 0.0}},
				{"point": 0.3, "color": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0}},
				{"point": 0.7, "color": {"r": 1.0, "g": 0.2, "b": 0.0, "a": 0.8}},
				{"point": 1.0, "color": {"r": 0.2, "g": 0.0, "b": 0.0, "a": 0.0}},
			],
		},
		"2d_snow": {
			"particleType": "CPUParticles2D",
			"amount": 200,
			"lifetime": 5.0,
			"emissionShape": "box",
			"spread": 20.0,
			"gravity": Vector2(0, 1),
			"initialVelocityMin": 0.5,
			"initialVelocityMax": 1.0,
			"scaleMin": 0.1,
			"scaleMax": 0.3,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 0.8}},
				{"point": 1.0, "color": {"r": 0.9, "g": 0.9, "b": 1.0, "a": 0.0}},
			],
		},
		"2d_confetti": {
			"particleType": "CPUParticles2D",
			"amount": 100,
			"lifetime": 3.0,
			"emissionShape": "point",
			"spread": 180.0,
			"gravity": Vector2(0, 2),
			"initialVelocityMin": 2.0,
			"initialVelocityMax": 4.0,
			"hueVariationMin": 0.0,
			"hueVariationMax": 1.0,
			"scaleMin": 0.2,
			"scaleMax": 0.4,
			"colors": [
				{"point": 0.0, "color": {"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0}},
				{"point": 0.2, "color": {"r": 0.0, "g": 1.0, "b": 0.0, "a": 1.0}},
				{"point": 0.4, "color": {"r": 0.0, "g": 0.0, "b": 1.0, "a": 1.0}},
				{"point": 0.6, "color": {"r": 1.0, "g": 1.0, "b": 0.0, "a": 1.0}},
				{"point": 0.8, "color": {"r": 1.0, "g": 0.0, "b": 1.0, "a": 1.0}},
				{"point": 1.0, "color": {"r": 0.0, "g": 1.0, "b": 1.0, "a": 0.0}},
			],
		},
	}

	if not preset_configs.has(preset):
		return {"ok": false, "error": "Unknown preset: " + preset + ". Available: " + ", ".join(preset_configs.keys())}

	var config: Dictionary = preset_configs[preset]
	var is_2d: bool = String(config["particleType"]).ends_with("2D")

	# Build arguments for create_particles
	var create_args := {
		"projectPath": project_path,
		"scenePath": scene_path,
		"parentNodePath": parent_node_path,
		"nodeName": node_name,
		"particleType": config["particleType"],
		"emissionShape": config["emissionShape"],
		"amount": config["amount"],
		"lifetime": config["lifetime"],
		"direction": Vector3.UP if not config.has("gravity") else (Vector3(0, 1, 0) if not is_2d else Vector3(0, 1, 0)),
		"spread": config["spread"],
		"initialVelocity": {"min": config["initialVelocityMin"], "max": config["initialVelocityMax"]},
	}

	# Handle gravity - convert Vector2 to Vector3 for 2D presets
	if config.has("gravity"):
		var grav = config["gravity"]
		if is_2d and grav is Vector2:
			# Convert Vector2 to Vector3 for the particle system
			create_args["gravity"] = {"x": grav.x, "y": grav.y, "z": 0.0}
		else:
			create_args["gravity"] = grav

	if config.has("explosiveness"):
		create_args["explosiveness"] = config["explosiveness"]

	# Create the particles first
	var create_result := create_particles(create_args)
	if not create_result.get("ok", false):
		return create_result

	# Now apply colors via set_particle_color_gradient
	if config.has("colors"):
		set_particle_color_gradient({
			"projectPath": project_path,
			"scenePath": scene_path,
			"nodePath": parent_node_path + "/" + node_name,
			"colors": config["colors"],
		})
		# Ignore result, particles were already created

	return {
		"ok": true,
		"nodeName": node_name,
		"nodeType": config["particleType"],
		"preset": preset,
		"particleCount": config["amount"],
		"lifetime": config["lifetime"],
	}


func get_particle_info(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))

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

	var is_particles_3d := target is GPUParticles3D or target is CPUParticles3D
	var is_particles_2d := target is GPUParticles2D or target is CPUParticles2D
	if not is_particles_3d and not is_particles_2d:
		root.queue_free()
		return {"ok": false, "error": "Node is not a particle node: " + node_path}

	var info := {
		"ok": true,
		"nodeName": target.name,
		"nodeType": target.get_class(),
		"is3D": is_particles_3d,
		"amount": target.get("amount"),
		"lifetime": target.get("lifetime"),
		"emitting": target.get("emitting"),
		"oneShot": target.get("one_shot"),
		"speedScale": target.get("speed_scale"),
	}

	# Get process material info
	var proc_mat = target.get("process_material")
	if proc_mat:
		info["processMaterial"] = {
			"hasMaterial": true,
		}

		# Common properties
		if "direction" in proc_mat:
			info["processMaterial"]["direction"] = _serialize_value(proc_mat.get("direction"))
		if "spread" in proc_mat:
			info["processMaterial"]["spread"] = proc_mat.get("spread")
		if "gravity" in proc_mat:
			info["processMaterial"]["gravity"] = _serialize_value(proc_mat.get("gravity"))
		if "initial_velocity_min" in proc_mat:
			info["processMaterial"]["initialVelocityMin"] = proc_mat.get("initial_velocity_min")
		if "initial_velocity_max" in proc_mat:
			info["processMaterial"]["initialVelocityMax"] = proc_mat.get("initial_velocity_max")
		if "color" in proc_mat:
			info["processMaterial"]["color"] = _serialize_value(proc_mat.get("color"))
		if "color_ramp" in proc_mat:
			info["processMaterial"]["hasColorRamp"] = proc_mat.get("color_ramp") != null
		if "scale_min" in proc_mat:
			info["processMaterial"]["scaleMin"] = proc_mat.get("scale_min")
		if "scale_max" in proc_mat:
			info["processMaterial"]["scaleMax"] = proc_mat.get("scale_max")
		if "turbulence_enabled" in proc_mat:
			info["processMaterial"]["turbulenceEnabled"] = proc_mat.get("turbulence_enabled")
	else:
		info["processMaterial"] = {"hasMaterial": false}

	# Get texture/draw pass info for 2D
	if not is_particles_3d:
		var texture = target.get("texture")
		if texture:
			info["texture"] = {"hasTexture": true}
		else:
			info["texture"] = {"hasTexture": false}

	# Get draw pass info for 3D
	if is_particles_3d:
		var draw_pass = target.get("draw_pass_1")
		if draw_pass:
			info["drawPass"] = {"hasPass": true}
		else:
			info["drawPass"] = {"hasPass": false}

	root.queue_free()
	return info