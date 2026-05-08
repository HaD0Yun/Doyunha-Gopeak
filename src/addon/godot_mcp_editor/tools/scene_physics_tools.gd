@tool
extends Node
class_name MCPScenePhysicsTools

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

		match expected_type:
			TYPE_VECTOR2:
				if value.has("x") and value.has("y"):
					return Vector2(value.get("x", 0), value.get("y", 0))
			TYPE_VECTOR3:
				if value.has("x") and value.has("y") and value.has("z"):
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
	
	if typeof(value) == TYPE_ARRAY:
		match expected_type:
			TYPE_VECTOR2:
				if value.size() >= 2:
					return Vector2(value[0], value[1])
			TYPE_VECTOR3:
				if value.size() >= 3:
					return Vector3(value[0], value[1], value[2])
	
	return value


func _set_owner_recursive(node: Node, scene_owner: Node) -> void:
	node.owner = scene_owner
	for child in node.get_children():
		if child is Node:
			_set_owner_recursive(child as Node, scene_owner)


func setup_collision(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var shape_type := str(args.get("shapeType", ""))
	var is_3d: bool = bool(args.get("is3D", false))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}
	if shape_type.is_empty():
		return {"ok": false, "error": "Missing shapeType"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var collision_node: Node
	var shape_res: Resource

	if is_3d:
		var col := CollisionShape3D.new()
		col.name = node_name
		collision_node = col
		
		match shape_type:
			"box":
				var s := BoxShape3D.new()
				var raw_size = args.get("size", null)
				if raw_size != null:
					s.size = _parse_value(raw_size, TYPE_VECTOR3)
				shape_res = s
			"sphere":
				var s := SphereShape3D.new()
				var radius = args.get("radius", 0.5)
				s.radius = float(radius)
				shape_res = s
			"capsule":
				var s := CapsuleShape3D.new()
				s.radius = float(args.get("radius", 0.5))
				s.height = float(args.get("height", 2.0))
				shape_res = s
			"cylinder":
				var s := CylinderShape3D.new()
				s.radius = float(args.get("radius", 0.5))
				s.height = float(args.get("height", 2.0))
				shape_res = s
			"world_boundary":
				shape_res = WorldBoundaryShape3D.new()
			_:
				root.queue_free()
				return {"ok": false, "error": "Unsupported 3D shapeType: " + shape_type}
		
		col.shape = shape_res
	else:
		var col := CollisionShape2D.new()
		col.name = node_name
		collision_node = col
		
		match shape_type:
			"box":
				var s := RectangleShape2D.new()
				var raw_size = args.get("size", null)
				if raw_size != null:
					var sz = _parse_value(raw_size, TYPE_VECTOR2)
					s.size = sz
				shape_res = s
			"sphere":
				var s := CircleShape2D.new()
				s.radius = float(args.get("radius", 10.0))
				shape_res = s
			"capsule":
				var s := CapsuleShape2D.new()
				s.radius = float(args.get("radius", 10.0))
				s.height = float(args.get("height", 40.0))
				shape_res = s
			"world_boundary":
				shape_res = WorldBoundaryShape2D.new()
			_:
				root.queue_free()
				return {"ok": false, "error": "Unsupported 2D shapeType: " + shape_type}
		
		col.shape = shape_res

	parent.add_child(collision_node)
	_set_owner_recursive(collision_node, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": collision_node.get_class()}


func setup_physics_body(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var body_type := str(args.get("bodyType", ""))
	var is_3d: bool = bool(args.get("is3D", false))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}
	if body_type.is_empty():
		return {"ok": false, "error": "Missing bodyType"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var body: Node
	if is_3d:
		match body_type:
			"static":
				body = StaticBody3D.new()
			"rigid":
				body = RigidBody3D.new()
			"character":
				body = CharacterBody3D.new()
			"area":
				body = Area3D.new()
			_:
				root.queue_free()
				return {"ok": false, "error": "Unknown 3D bodyType: " + body_type}
	else:
		match body_type:
			"static":
				body = StaticBody2D.new()
			"rigid":
				body = RigidBody2D.new()
			"character":
				body = CharacterBody2D.new()
			"area":
				body = Area2D.new()
			_:
				root.queue_free()
				return {"ok": false, "error": "Unknown 2D bodyType: " + body_type}

	body.name = node_name
	parent.add_child(body)
	_set_owner_recursive(body, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": body.get_class()}


func add_raycast(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var node_name := str(args.get("nodeName", ""))
	var is_3d: bool = bool(args.get("is3D", false))

	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var ray: Node
	if is_3d:
		var r := RayCast3D.new()
		var target = args.get("targetPosition", null)
		if target != null:
			r.target_position = _parse_value(target, TYPE_VECTOR3)
		ray = r
	else:
		var r := RayCast2D.new()
		var target = args.get("targetPosition", null)
		if target != null:
			r.target_position = _parse_value(target, TYPE_VECTOR2)
		ray = r

	ray.name = node_name
	var enabled_arg = args.get("enabled", true)
	ray.enabled = bool(enabled_arg)
	parent.add_child(ray)
	_set_owner_recursive(ray, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": ray.get_class()}


func set_physics_layers(args: Dictionary) -> Dictionary:
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

	var layer = args.get("collisionLayer")
	var mask = args.get("collisionMask")

	if layer == null and mask == null:
		root.queue_free()
		return {"ok": false, "error": "No collisionLayer or collisionMask values provided"}

	var applied := []
	if layer != null:
		if target.has_method("set_collision_layer"):
			target.set_collision_layer(int(layer))
		elif "collision_layer" in target:
			target.collision_layer = int(layer)
		else:
			root.queue_free()
			return {"ok": false, "error": "Node does not support collision_layer: " + node_path}
		applied.append("collisionLayer")

	if mask != null:
		if target.has_method("set_collision_mask"):
			target.set_collision_mask(int(mask))
		elif "collision_mask" in target:
			target.collision_mask = int(mask)
		else:
			root.queue_free()
			return {"ok": false, "error": "Node does not support collision_mask: " + node_path}
		applied.append("collisionMask")

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodePath": node_path, "applied": applied}


func get_physics_layers(args: Dictionary) -> Dictionary:
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

	var layer = null
	var mask = null

	if "collision_layer" in target:
		layer = target.collision_layer
	elif target.has_method("get_collision_layer"):
		layer = target.get_collision_layer()

	if "collision_mask" in target:
		mask = target.collision_mask
	elif target.has_method("get_collision_mask"):
		mask = target.get_collision_mask()

	var has_physics_props := layer != null or mask != null
	var node_class := target.get_class()
	root.queue_free()

	var note := ""
	if not has_physics_props:
		note = "Node " + node_class + " does not expose collision_layer/collision_mask. Point this at a PhysicsBody or Area, not a CollisionShape."

	return {
		"ok": true,
		"collisionLayer": layer,
		"collisionMask": mask,
		"note": note,
	}


func get_collision_info(_args: Dictionary) -> Dictionary:
	var layers_2d := {}
	var layers_3d := {}

	for i in range(1, 33):
		var name_2d = ProjectSettings.get_setting("layer_names/2d_physics/layer_" + str(i), "")
		if not name_2d.is_empty():
			layers_2d[i] = name_2d
		
		var name_3d = ProjectSettings.get_setting("layer_names/3d_physics/layer_" + str(i), "")
		if not name_3d.is_empty():
			layers_3d[i] = name_3d

	return {
		"ok": true,
		"layers2D": layers_2d,
		"layers3D": layers_3d
	}
