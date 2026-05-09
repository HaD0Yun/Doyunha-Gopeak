@tool
extends Node
class_name MCPScene2DTools

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

		match expected_type:
			TYPE_VECTOR2:
				return Vector2(value.get("x", 0), value.get("y", 0))
			TYPE_VECTOR3:
				return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
			TYPE_COLOR:
				return Color(value.get("r", 1), value.get("g", 1), value.get("b", 1), value.get("a", 1))

	return value


func add_sprite_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "Sprite2D")
	var texture_path: String = args.get("texture", "")
	var region: Dictionary = args.get("region", {})
	var frames: int = args.get("frames", 1)
	var hframes: int = args.get("hframes", 1) if args.has("hframes") else frames
	var vframes: int = args.get("vframes", 1)

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var sprite := Sprite2D.new()
	sprite.name = node_name

	if texture_path != "":
		var tex_res_path := _ensure_res_path(texture_path)
		if ResourceLoader.exists(tex_res_path):
			var tex := load(tex_res_path)
			if tex:
				sprite.texture = tex
				if region.has("x") or region.has("y") or region.has("width") or region.has("height"):
					sprite.region_enabled = true
					sprite.region_rect = Rect2(
						region.get("x", 0),
						region.get("y", 0),
						region.get("width", tex.get_width()),
						region.get("height", tex.get_height())
					)
				if hframes > 1 or vframes > 1:
					sprite.hframes = hframes
					sprite.vframes = vframes

	var position: Dictionary = args.get("position", {})
	if position.has("x") or position.has("y"):
		sprite.position = _parse_value(position, TYPE_VECTOR2)

	if args.has("rotation"):
		sprite.rotation = deg_to_rad(args.get("rotation", 0.0))

	var scale: Dictionary = args.get("scale", {})
	if scale.has("x") or scale.has("y"):
		sprite.scale = _parse_value(scale, TYPE_VECTOR2)

	parent.add_child(sprite)
	if sprite.get_parent() and _editor_plugin:
		sprite.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "Sprite2D"
	}


func setup_camera_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "Camera2D")
	var target_path: String = args.get("targetPath", "")
	var zoom: Dictionary = args.get("zoom", {"x": 1, "y": 1})
	var limits: Array = args.get("limits", [])
	var smoothing: float = args.get("smoothing", 0.0)
	var position: Dictionary = args.get("position", {})

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var camera := Camera2D.new()
	camera.name = node_name

	if zoom.has("x") or zoom.has("y"):
		camera.zoom = _parse_value(zoom, TYPE_VECTOR2)

	if limits.size() >= 4:
		camera.limit_left = limits[0]
		camera.limit_top = limits[1]
		camera.limit_right = limits[2]
		camera.limit_bottom = limits[3]

	if args.has("smoothing"):
		camera.position_smoothing_enabled = smoothing > 0
		camera.position_smoothing_speed = smoothing

	if position.has("x") or position.has("y"):
		camera.position = _parse_value(position, TYPE_VECTOR2)

	parent.add_child(camera)
	if camera.get_parent() and _editor_plugin:
		camera.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "Camera2D"
	}


func add_canvas_layer(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "CanvasLayer")
	var layer_index: int = args.get("layerIndex", 0)
	var follow_viewport: bool = args.get("followViewport", false)

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var canvas_layer := CanvasLayer.new()
	canvas_layer.name = node_name
	canvas_layer.layer = layer_index
	canvas_layer.follow_viewport = follow_viewport

	parent.add_child(canvas_layer)
	if canvas_layer.get_parent() and _editor_plugin:
		canvas_layer.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "CanvasLayer"
	}


func setup_parallax_background(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "ParallaxBackground")
	var layers: Array = args.get("layers", [])

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var parallax_bg := ParallaxBackground.new()
	parallax_bg.name = node_name

	parent.add_child(parallax_bg)
	if parallax_bg.get_parent() and _editor_plugin:
		parallax_bg.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	var created_layers: Array = []

	for i in range(layers.size()):
		var layer_data: Dictionary = layers[i]
		var layer_name: String = layer_data.get("name", "Layer" + str(i))
		var texture_path: String = layer_data.get("texture", "")
		var motion_scale: Vector2 = _parse_value(layer_data.get("motionScale", {"x": 0.5, "y": 0.5}), TYPE_VECTOR2)
		var position: Vector2 = _parse_value(layer_data.get("position", {}), TYPE_VECTOR2)
		var scale: Vector2 = _parse_value(layer_data.get("scale", {"x": 1, "y": 1}), TYPE_VECTOR2)

		var parallax_layer := ParallaxLayer.new()
		parallax_layer.name = layer_name
		parallax_layer.motion_scale = motion_scale
		parallax_layer.position = position
		parallax_layer.scale = scale

		parallax_bg.add_child(parallax_layer)
		if parallax_layer.get_parent() and _editor_plugin:
			parallax_layer.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

		if texture_path != "":
			var sprite := Sprite2D.new()
			sprite.name = "Sprite"
			var tex_res_path := _ensure_res_path(texture_path)
			if ResourceLoader.exists(tex_res_path):
				sprite.texture = load(tex_res_path)
			parallax_layer.add_child(sprite)
			if sprite.get_parent() and _editor_plugin:
				sprite.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

		created_layers.push_back(parent_node_path + "/" + node_name + "/" + layer_name)

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"layers": created_layers
	}


func add_area_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "Area2D")
	var shape_type: String = args.get("shape", "rectangle")
	var size: Dictionary = args.get("size", {"x": 32, "y": 32})
	var layers: int = args.get("layers", 1)
	var monitorable: bool = args.get("monitorable", true)

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var area := Area2D.new()
	area.name = node_name
	area.monitorable = monitorable
	area.collision_layer = layers
	area.collision_mask = layers

	parent.add_child(area)
	if area.get_parent() and _editor_plugin:
		area.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	var shape_node: CollisionShape2D = _create_collision_shape(shape_type, size, node_name + "_shape")
	area.add_child(shape_node)
	if shape_node.get_parent() and _editor_plugin:
		shape_node.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "Area2D",
		"shapePath": parent_node_path + "/" + node_name + "/" + node_name + "_shape"
	}


func _create_collision_shape(shape_type: String, size: Dictionary, shape_name: String) -> CollisionShape2D:
	var shape_node := CollisionShape2D.new()
	shape_node.name = shape_name

	var vec_size := _parse_value(size, TYPE_VECTOR2)

	match shape_type:
		"rectangle":
			var rect_shape := RectangleShape2D.new()
			rect_shape.size = vec_size
			shape_node.shape = rect_shape
		"circle":
			var radius: float = size.get("radius", vec_size.x / 2)
			var circle_shape := CircleShape2D.new()
			circle_shape.radius = radius
			shape_node.shape = circle_shape
		"capsule":
			var capsule_shape := CapsuleShape2D.new()
			capsule_shape.radius = size.get("radius", vec_size.x / 2)
			capsule_shape.height = vec_size.y
			shape_node.shape = capsule_shape

	return shape_node


func setup_character_body_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "CharacterBody2D")
	var shape_type: String = args.get("shape", "capsule")
	var size: Dictionary = args.get("size", {"x": 32, "y": 64})
	var sprite_path: String = args.get("sprite", "")
	var script_template: String = args.get("script", "")

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var character_body := CharacterBody2D.new()
	character_body.name = node_name

	parent.add_child(character_body)
	if character_body.get_parent() and _editor_plugin:
		character_body.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	var shape_node: CollisionShape2D = _create_collision_shape(shape_type, size, node_name + "_collision")
	character_body.add_child(shape_node)
	if shape_node.get_parent() and _editor_plugin:
		shape_node.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	if sprite_path != "":
		var sprite := Sprite2D.new()
		sprite.name = "Sprite"
		var tex_res_path := _ensure_res_path(sprite_path)
		if ResourceLoader.exists(tex_res_path):
			sprite.texture = load(tex_res_path)
		character_body.add_child(sprite)
		if sprite.get_parent() and _editor_plugin:
			sprite.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	if script_template != "" and script_template != "none":
		var script_obj: GDScript = _create_movement_script(script_template, node_name)
		if script_obj:
			character_body.set_script(script_obj)

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "CharacterBody2D"
	}


func _create_movement_script(template: String, node_name: String) -> GDScript:
	var script_code := ""

	match template:
		"platformer":
			script_code = """extends CharacterBody2D

const SPEED := 300.0
const JUMP_VELOCITY := -400.0

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta

	var direction := Input.get_axis("ui_left", "ui_right")
	if direction:
		velocity.x = direction * SPEED
	else:
		velocity.x = move_toward(velocity.x, 0, SPEED)

	if Input.is_action_just_pressed("ui_accept") and is_on_floor():
		velocity.y = JUMP_VELOCITY

	move_and_slide()
"""
		"top_down":
			script_code = """extends CharacterBody2D

const SPEED := 200.0

var _direction := Vector2.ZERO

func _physics_process(_delta: float) -> void:
	_direction.x = Input.get_axis("ui_left", "ui_right")
	_direction.y = Input.get_axis("ui_up", "ui_down")
	_direction = _direction.normalized()

	velocity = _direction * SPEED
	move_and_slide()
"""

	if script_code.is_empty():
		return null

	var script_dir := "res://scripts"
	if not DirAccess.dir_exists(script_dir):
		DirAccess.make_dir_recursive_absolute(script_dir)

	var sanitized_name := node_name.replace(" ", "_").replace("/", "_")
	var script_path := script_dir + "/" + sanitized_name + ".gd"

	var file := FileAccess.open(script_path, FileAccess.WRITE)
	if file:
		file.store_string(script_code)
		file.close()

	return load(script_path) as GDScript


func setup_static_body_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "StaticBody2D")
	var shape_type: String = args.get("shape", "rectangle")
	var size: Dictionary = args.get("size", {"x": 32, "y": 32})
	var layers: int = args.get("layers", 1)

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var static_body := StaticBody2D.new()
	static_body.name = node_name
	static_body.collision_layer = layers
	static_body.collision_mask = layers

	parent.add_child(static_body)
	if static_body.get_parent() and _editor_plugin:
		static_body.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	var shape_node: CollisionShape2D = _create_collision_shape(shape_type, size, node_name + "_collision")
	static_body.add_child(shape_node)
	if shape_node.get_parent() and _editor_plugin:
		shape_node.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "StaticBody2D"
	}


func add_y_sort_container(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "YSort")

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var y_sort := Node2D.new()
	y_sort.name = node_name
	y_sort.y_sort_enabled = true

	parent.add_child(y_sort)
	if y_sort.get_parent() and _editor_plugin:
		y_sort.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "YSort"
	}


func set_node_2d_transform(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var node_path: String = args.get("nodePath", ".")
	var position: Dictionary = args.get("position", {})
	var scale: Dictionary = args.get("scale", {})

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var target_node: Node = _find_node(scene_root, node_path)
	if not target_node:
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found: " + node_path}

	if position.has("x") or position.has("y"):
		target_node.position = _parse_value(position, TYPE_VECTOR2)

	if args.has("rotation"):
		target_node.rotation = deg_to_rad(args.get("rotation", 0.0))

	if scale.has("x") or scale.has("y"):
		target_node.scale = _parse_value(scale, TYPE_VECTOR2)

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": node_path
	}


func add_path_2d(args: Dictionary) -> Dictionary:
	var project_path: String = args.get("projectPath", "")
	var scene_path: String = args.get("scenePath", "")
	var parent_node_path: String = args.get("parentNodePath", ".")
	var node_name: String = args.get("nodeName", "Path2D")
	var points: Array = args.get("points", [])
	var closed: bool = args.get("closed", false)

	var scene_res_path := _to_scene_res_path(project_path, scene_path)
	var result := _load_scene(scene_res_path)
	if result[0] == null:
		return result[1]

	var scene_root: Node = result[0]
	var parent: Node = _find_node(scene_root, parent_node_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_node_path}

	var path_node := Path2D.new()
	path_node.name = node_name

	var curve := Curve2D.new()
	for i in range(points.size()):
		var point_dict: Dictionary = points[i]
		var point := _parse_value(point_dict, TYPE_VECTOR2)
		var in_tangent := _parse_value(point_dict.get("in", {}), TYPE_VECTOR2)
		var out_tangent := _parse_value(point_dict.get("out", {}), TYPE_VECTOR2)
		curve.add_point(point, in_tangent, out_tangent)
	curve.closed = closed
	path_node.curve = curve

	parent.add_child(path_node)
	if path_node.get_parent() and _editor_plugin:
		path_node.set_owner(_editor_plugin.get_editor_interface().get_edited_scene_root())

	_save_scene(scene_root, scene_res_path)
	return {
		"ok": true,
		"nodePath": parent_node_path + "/" + node_name,
		"nodeType": "Path2D"
	}