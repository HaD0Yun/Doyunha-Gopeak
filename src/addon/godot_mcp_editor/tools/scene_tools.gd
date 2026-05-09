@tool
extends Node
class_name MCPSceneTools

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


func _build_node_tree(node: Node, include_properties: bool, depth: int, current_depth: int, node_path: String) -> Dictionary:
	var data := {
		"name": str(node.name),
		"type": node.get_class(),
		"path": node_path,
		"children": []
	}

	if include_properties:
		var props := {}
		for p in node.get_property_list():
			if not (p.get("usage", 0) & PROPERTY_USAGE_STORAGE):
				continue
			var pn := str(p.get("name", ""))
			if pn.is_empty():
				continue
			props[pn] = _serialize_value(node.get(pn))
		data["properties"] = props

	if depth >= 0 and current_depth >= depth:
		return data

	for child in node.get_children():
		if child is Node:
			var child_node := child as Node
			var child_path := str(child_node.name) if node_path == "." else node_path + "/" + str(child_node.name)
			data["children"].append(_build_node_tree(child_node, include_properties, depth, current_depth + 1, child_path))

	return data


func _collect_nodes_recursive(node: Node, path: String, out_nodes: Array) -> void:
	out_nodes.append({"path": path, "node": node})
	for child in node.get_children():
		if child is Node:
			var child_node := child as Node
			var child_path := str(child_node.name) if path == "." else path + "/" + str(child_node.name)
			_collect_nodes_recursive(child_node, child_path, out_nodes)


func create_scene(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var root_node_type := str(args.get("rootNodeType", "Node"))
	var script_path := str(args.get("scriptPath", ""))

	if scene_path == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if not scene_path.ends_with(".tscn"):
		scene_path += ".tscn"
	if not ClassDB.class_exists(root_node_type):
		return {"ok": false, "error": "Invalid rootNodeType: " + root_node_type}

	_ensure_parent_dir_for_scene(scene_path)

	var root := ClassDB.instantiate(root_node_type) as Node
	if not root:
		return {"ok": false, "error": "Failed to instantiate root node: " + root_node_type}
	root.name = scene_path.get_file().get_basename()

	if not script_path.is_empty():
		var full_script_path := _to_scene_res_path(project_path, script_path)
		var script = load(full_script_path)
		if not script:
			root.queue_free()
			return {"ok": false, "error": "Failed to load script: " + full_script_path}
		root.set_script(script)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "scenePath": scene_path, "rootNodeType": root_node_type}


func list_scene_nodes(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var depth := int(args.get("depth", -1))
	var include_properties := bool(args.get("includeProperties", false))

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var tree := _build_node_tree(root, include_properties, depth, 0, ".")
	root.queue_free()
	return {"ok": true, "tree": tree}


func add_node(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_type := str(args.get("nodeType", ""))
	var node_name := str(args.get("nodeName", ""))
	var parent_node_path := str(args.get("parentNodePath", "."))
	var properties := _parse_properties_arg(args.get("properties", {}))

	if node_type.is_empty() or node_name.is_empty():
		return {"ok": false, "error": "Missing nodeType or nodeName"}
	if not ClassDB.class_exists(node_type):
		return {"ok": false, "error": "Invalid nodeType: " + node_type}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var parent := _find_node(root, parent_node_path)
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var new_node := ClassDB.instantiate(node_type) as Node
	if not new_node:
		root.queue_free()
		return {"ok": false, "error": "Failed to instantiate nodeType: " + node_type}

	new_node.name = node_name
	_set_node_properties(new_node, properties)
	parent.add_child(new_node)
	_set_owner_recursive(new_node, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodeName": node_name, "nodeType": node_type}


func delete_node(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))

	if node_path.is_empty() or node_path == ".":
		return {"ok": false, "error": "Cannot delete root node"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var node := _find_node(root, node_path)
	if not node:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var parent := node.get_parent()
	if not parent:
		root.queue_free()
		return {"ok": false, "error": "Cannot delete root node"}

	parent.remove_child(node)
	node.queue_free()

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "deletedNodePath": node_path}


func duplicate_node(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))
	var new_name := str(args.get("newName", ""))
	var parent_path := str(args.get("parentPath", ""))

	if node_path.is_empty() or new_name.is_empty():
		return {"ok": false, "error": "Missing nodePath or newName"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var source := _find_node(root, node_path)
	if not source:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var target_parent: Node = source.get_parent()
	if not parent_path.is_empty():
		target_parent = _find_node(root, parent_path)
	if not target_parent:
		root.queue_free()
		return {"ok": false, "error": "Parent not found: " + parent_path}

	var duplicated_node := source.duplicate() as Node
	if not duplicated_node:
		root.queue_free()
		return {"ok": false, "error": "Failed to duplicate node: " + node_path}

	duplicated_node.name = new_name
	target_parent.add_child(duplicated_node)
	_set_owner_recursive(duplicated_node, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodePath": node_path, "newName": new_name}


func reparent_node(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", ""))
	var new_parent_path := str(args.get("newParentPath", ""))

	if node_path.is_empty() or node_path == ".":
		return {"ok": false, "error": "Cannot reparent root node"}
	if new_parent_path.is_empty():
		return {"ok": false, "error": "Missing newParentPath"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var node := _find_node(root, node_path)
	var new_parent := _find_node(root, new_parent_path)
	if not node:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}
	if not new_parent:
		root.queue_free()
		return {"ok": false, "error": "New parent not found: " + new_parent_path}

	var old_parent := node.get_parent()
	if not old_parent:
		root.queue_free()
		return {"ok": false, "error": "Cannot reparent root node"}

	old_parent.remove_child(node)
	new_parent.add_child(node)
	_set_owner_recursive(node, root)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodePath": node_path, "newParentPath": new_parent_path}


func set_node_properties(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", "."))
	var properties := _parse_properties_arg(args.get("properties", {}))

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var node := _find_node(root, node_path)
	if not node:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	_set_node_properties(node, properties)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodePath": node_path}


func get_node_properties(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", "."))
	var include_defaults := bool(args.get("includeDefaults", false))

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var node := _find_node(root, node_path)
	if not node:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var defaults: Node = null
	if not include_defaults and ClassDB.class_exists(node.get_class()):
		defaults = ClassDB.instantiate(node.get_class()) as Node

	var props := {}
	for p in node.get_property_list():
		var usage := int(p.get("usage", 0))
		if not (usage & PROPERTY_USAGE_STORAGE):
			continue
		var prop_name := str(p.get("name", ""))
		if prop_name.is_empty():
			continue
		var current_val = node.get(prop_name)
		if not include_defaults and defaults:
			var default_val = defaults.get(prop_name)
			if current_val == default_val:
				continue
		props[prop_name] = _serialize_value(current_val)

	if defaults:
		defaults.queue_free()
	root.queue_free()
	return {"ok": true, "nodePath": node_path, "properties": props}


func load_sprite(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var node_path := str(args.get("nodePath", "."))
	var texture_path := _to_scene_res_path(project_path, str(args.get("texturePath", "")))

	if texture_path == "res://":
		return {"ok": false, "error": "Missing texturePath"}

	var texture = load(texture_path)
	if not texture or not (texture is Texture2D):
		return {"ok": false, "error": "Failed to load texture: " + texture_path}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var node := _find_node(root, node_path)
	if not node:
		root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	if node is Sprite2D:
		(node as Sprite2D).texture = texture as Texture2D
	elif node is Sprite3D:
		(node as Sprite3D).texture = texture as Texture2D
	else:
		root.queue_free()
		return {"ok": false, "error": "Node is not Sprite2D or Sprite3D: " + node_path}

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {"ok": true, "nodePath": node_path, "texturePath": texture_path}


func save_scene(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var new_path_raw := str(args.get("newPath", ""))
	var target_path := scene_path
	if not new_path_raw.is_empty():
		target_path = _to_scene_res_path(project_path, new_path_raw)

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	_ensure_parent_dir_for_scene(target_path)
	var root := result[0] as Node
	var err := _save_scene(root, target_path)
	if not err.is_empty():
		return err

	return {"ok": true, "scenePath": scene_path, "savedPath": target_path}


func connect_signal(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var source_node_path := str(args.get("sourceNodePath", ""))
	var signal_name := str(args.get("signalName", ""))
	var target_node_path := str(args.get("targetNodePath", ""))
	var method_name := str(args.get("methodName", ""))
	var flags := int(args.get("flags", 0))

	if source_node_path.is_empty() or signal_name.is_empty() or target_node_path.is_empty() or method_name.is_empty():
		return {"ok": false, "error": "Missing required signal connection arguments"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var source := _find_node(root, source_node_path)
	var target := _find_node(root, target_node_path)
	if not source:
		root.queue_free()
		return {"ok": false, "error": "Source node not found: " + source_node_path}
	if not target:
		root.queue_free()
		return {"ok": false, "error": "Target node not found: " + target_node_path}
	if not source.has_signal(signal_name):
		root.queue_free()
		return {"ok": false, "error": "Signal not found on source: " + signal_name}

	var callable := Callable(target, method_name)
	if not source.is_connected(signal_name, callable):
		var connect_result := source.connect(signal_name, callable, flags)
		if connect_result != OK:
			root.queue_free()
			return {"ok": false, "error": "Failed to connect signal: " + str(connect_result)}

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"sourceNodePath": source_node_path,
		"signalName": signal_name,
		"targetNodePath": target_node_path,
		"methodName": method_name,
		"flags": flags
	}


func disconnect_signal(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var source_node_path := str(args.get("sourceNodePath", ""))
	var signal_name := str(args.get("signalName", ""))
	var target_node_path := str(args.get("targetNodePath", ""))
	var method_name := str(args.get("methodName", ""))

	if source_node_path.is_empty() or signal_name.is_empty() or target_node_path.is_empty() or method_name.is_empty():
		return {"ok": false, "error": "Missing required signal disconnection arguments"}

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var source := _find_node(root, source_node_path)
	var target := _find_node(root, target_node_path)
	if not source:
		root.queue_free()
		return {"ok": false, "error": "Source node not found: " + source_node_path}
	if not target:
		root.queue_free()
		return {"ok": false, "error": "Target node not found: " + target_node_path}

	var callable := Callable(target, method_name)
	if source.is_connected(signal_name, callable):
		source.disconnect(signal_name, callable)

	var err := _save_scene(root, scene_path)
	if not err.is_empty():
		return err

	return {
		"ok": true,
		"sourceNodePath": source_node_path,
		"signalName": signal_name,
		"targetNodePath": target_node_path,
		"methodName": method_name
	}


func list_connections(args: Dictionary) -> Dictionary:
	var project_path := str(args.get("projectPath", ""))
	var scene_path := _to_scene_res_path(project_path, str(args.get("scenePath", "")))
	var filter_path := str(args.get("nodePath", ""))

	var result := _load_scene(scene_path)
	if not result[1].is_empty():
		return result[1]

	var root := result[0] as Node
	var nodes: Array = []
	_collect_nodes_recursive(root, ".", nodes)

	var connections: Array = []
	for entry in nodes:
		var path := str(entry["path"])
		if not filter_path.is_empty() and filter_path != path:
			continue
		var node := entry["node"] as Node
		for signal_info in node.get_signal_list():
			var signal_name := str(signal_info.get("name", ""))
			if signal_name.is_empty():
				continue
			for conn in node.get_signal_connection_list(signal_name):
				var callable: Callable = conn.get("callable", Callable())
				var target_obj: Object = callable.get_object()
				var target_path := ""
				if target_obj and target_obj is Node:
					target_path = str(root.get_path_to(target_obj as Node))
				connections.append({
					"sourceNodePath": path,
					"signalName": signal_name,
					"targetNodePath": target_path,
					"methodName": str(callable.get_method()),
					"flags": int(conn.get("flags", 0))
				})

	root.queue_free()
	return {"ok": true, "connections": connections}


# =============================================================================
# move_node — reorder a node among its siblings (sibling index change)
# =============================================================================
func move_node(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var node_path: String = str(args.get("nodePath", ""))
	var new_index: int = int(args.get("newIndex", 0))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if node_path.is_empty():
		return {"ok": false, "error": "Missing nodePath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var node := _find_node(scene_root, node_path)
	if not node:
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var parent := node.get_parent()
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Node has no parent: " + node_path}

	var siblings := parent.get_children()
	var current_index := siblings.find(node)
	if current_index < 0:
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found among parent's children"}

	var clamped_index := clampi(new_index, 0, siblings.size() - 1)
	if current_index == clamped_index:
		scene_root.queue_free()
		return {"ok": true, "nodePath": node_path, "index": current_index, "moved": false}

	parent.move_child(node, clamped_index)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodePath": node_path, "oldIndex": current_index, "newIndex": clamped_index, "moved": true}


# =============================================================================
# rename_node — rename a node in the scene tree
# =============================================================================
func rename_node(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var node_path: String = str(args.get("nodePath", ""))
	var new_name: String = str(args.get("newName", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if node_path.is_empty():
		return {"ok": false, "error": "Missing nodePath"}
	if new_name.strip_edges().is_empty():
		return {"ok": false, "error": "Missing newName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var node := _find_node(scene_root, node_path)
	if not node:
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	var old_name := node.name
	node.name = new_name.strip_edges()

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodePath": node_path, "oldName": old_name, "newName": node.name}


# =============================================================================
# set_anchor_preset — set Control node anchor preset
# =============================================================================
func set_anchor_preset(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var node_path: String = str(args.get("nodePath", ""))
	var anchor_preset_name: String = str(args.get("anchorPreset", "FullRect"))
	var keep_margins: bool = bool(args.get("keepMargins", false))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if node_path.is_empty():
		return {"ok": false, "error": "Missing nodePath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var node := _find_node(scene_root, node_path)
	if not node:
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	if not node is Control:
		scene_root.queue_free()
		return {"ok": false, "error": "Node is not a Control: " + node_path}

	var preset_map := {
		"None": Control.PRESET_NONE,
		"FullRect": Control.PRESET_FULL_RECT,
		"CenterLeft": Control.PRESET_CENTER_LEFT,
		"CenterTop": Control.PRESET_CENTER_TOP,
		"CenterRight": Control.PRESET_CENTER_RIGHT,
		"CenterBottom": Control.PRESET_CENTER_BOTTOM,
		"Center": Control.PRESET_CENTER,
		"LeftTop": Control.PRESET_LEFT_TOP,
		"LeftCenter": Control.PRESET_LEFT_CENTER,
		"LeftBottom": Control.PRESET_LEFT_BOTTOM,
		"RightTop": Control.PRESET_RIGHT_TOP,
		"RightCenter": Control.PRESET_RIGHT_CENTER,
		"RightBottom": Control.PRESET_RIGHT_BOTTOM,
		"TopCenter": Control.PRESET_TOP_CENTER,
		"BottomCenter": Control.PRESET_BOTTOM_CENTER,
	}

	if not preset_map.has(anchor_preset_name):
		scene_root.queue_free()
		return {"ok": false, "error": "Unknown anchorPreset: " + anchor_preset_name}
	node.set_anchors_preset(preset_map[anchor_preset_name] as int, keep_margins)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodePath": node_path, "anchorPreset": anchor_preset_name, "keepMargins": keep_margins}


# =============================================================================
# read_resource — read a resource file and return its properties
# =============================================================================
func read_resource(args: Dictionary) -> Dictionary:
	var resource_path: String = _ensure_res_path(str(args.get("resourcePath", "")))

	if resource_path.strip_edges() == "res://" or resource_path.strip_edges().is_empty():
		return {"ok": false, "error": "Missing resourcePath"}

	if not FileAccess.file_exists(resource_path):
		return {"ok": false, "error": "Resource not found: " + resource_path}

	var resource: Resource = load(resource_path)

	if not resource:
		return {"ok": false, "error": "Failed to load resource: " + resource_path}

	var properties: Dictionary = {}
	for prop in resource.get_property_list():
		var name := str(prop.get("name", ""))
		if name.is_empty() or name.begins_with("Object"):
			continue
		var value = resource.get(name)
		properties[name] = _serialize_value(value)

	return {
		"ok": true,
		"resourcePath": resource_path,
		"type": resource.get_class(),
		"properties": properties,
	}


# =============================================================================
# edit_resource — update properties on a resource file
# =============================================================================
func edit_resource(args: Dictionary) -> Dictionary:
	var resource_path: String = _ensure_res_path(str(args.get("resourcePath", "")))
	var properties: Dictionary = args.get("properties", {})

	if resource_path.strip_edges() == "res://" or resource_path.strip_edges().is_empty():
		return {"ok": false, "error": "Missing resourcePath"}
	if properties.is_empty():
		return {"ok": false, "error": "Missing properties"}

	if not FileAccess.file_exists(resource_path):
		return {"ok": false, "error": "Resource not found: " + resource_path}

	var resource: Resource = load(resource_path)
	if not resource:
		return {"ok": false, "error": "Failed to load resource: " + resource_path}

	for key in properties:
		var prop_name := str(key)
		var raw_value = properties.get(key)
		var parsed_value = _parse_value(raw_value)
		resource.set(prop_name, parsed_value)

	var save_err := ResourceSaver.save(resource)
	if save_err != OK:
		return {"ok": false, "error": "Failed to save resource: " + resource_path}

	_refresh_filesystem()

	return {"ok": true, "resourcePath": resource_path, "updated": properties.keys().size()}


# =============================================================================
# execute_editor_script — run arbitrary GDScript in the editor context
# =============================================================================
func execute_editor_script(args: Dictionary) -> Dictionary:
	var script_code: String = str(args.get("scriptCode", ""))

	if script_code.strip_edges().is_empty():
		return {"ok": false, "error": "Missing scriptCode"}

	if not _editor_plugin:
		return {"ok": false, "error": "Editor plugin not available (execute_editor_script requires editor context)"}

	var ei := _editor_plugin.get_editor_interface()
	var edited_scene := ei.get_edited_scene_root()
	if not edited_scene:
		return {"ok": false, "error": "No scene open in the editor"}

	var script := GDScript.new()
	script.source_code = script_code

	var result := {"ok": true, "output": ""}
	var output_lines: Array = []

	var ctx := {
		"scene_root": edited_scene,
		"editor_interface": ei,
		"output": output_lines,
	}

	script.reload()

	var instance: Object = script.new()
	if not instance:
		return {"ok": false, "error": "Script instantiation failed"}

	if instance.has_method("_execute"):
		var exec_result = instance.call("_execute", ctx)
		if exec_result is Dictionary and exec_result.has("error"):
			result["ok"] = false
			result["error"] = exec_result.get("error")

	for line in output_lines:
		result["output"] += str(line) + "\n"

	if instance is Node:
		instance.queue_free()
	elif not instance is RefCounted:
		instance.free()

	return result


# =============================================================================
# clear_output — clear the Output dock (no-op unless editor available)
# =============================================================================
func clear_output(args: Dictionary) -> Dictionary:
	return {"ok": true, "message": "Output cleared (no-op in headless mode)"}


# =============================================================================
# reload_plugin — reload the MCP editor plugin
# =============================================================================
func reload_plugin(args: Dictionary) -> Dictionary:
	if not _editor_plugin:
		return {"ok": false, "error": "Editor plugin not available"}
	_editor_plugin.get_editor_interface().get_resource_filesystem().scan()
	return {"ok": true, "message": "Plugin reload triggered"}


# =============================================================================
# reload_project — re-scan the project filesystem and reload all scenes
# =============================================================================
func reload_project(args: Dictionary) -> Dictionary:
	if not _editor_plugin:
		return {"ok": false, "error": "Editor plugin not available"}
	var ei := _editor_plugin.get_editor_interface()
	ei.get_resource_filesystem().scan()
	var edited_root := ei.get_edited_scene_root()
	if edited_root and not edited_root.scene_file_path.is_empty():
		ei.reload_scene_from_path(edited_root.scene_file_path)
	return {"ok": true, "message": "Project reload triggered"}
