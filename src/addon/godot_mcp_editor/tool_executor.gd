@tool
extends Node
class_name MCPToolExecutor

var _editor_plugin: EditorPlugin = null

var _scene_tools: Node = null
var _resource_tools: Node = null
var _animation_tools: Node = null
var _scene_3d_tools: Node = null
var _scene_physics_tools: Node = null
var _scene_particles_tools: Node = null

var _tool_map: Dictionary = {}
var _initialized := false


func set_editor_plugin(plugin: EditorPlugin) -> void:
	_editor_plugin = plugin
	_init_tools()

	if _scene_tools and _scene_tools.has_method("set_editor_plugin"):
		_scene_tools.set_editor_plugin(plugin)
	if _resource_tools and _resource_tools.has_method("set_editor_plugin"):
		_resource_tools.set_editor_plugin(plugin)
	if _animation_tools and _animation_tools.has_method("set_editor_plugin"):
		_animation_tools.set_editor_plugin(plugin)
	if _scene_3d_tools and _scene_3d_tools.has_method("set_editor_plugin"):
		_scene_3d_tools.set_editor_plugin(plugin)
	if _scene_physics_tools and _scene_physics_tools.has_method("set_editor_plugin"):
		_scene_physics_tools.set_editor_plugin(plugin)
	if _scene_particles_tools and _scene_particles_tools.has_method("set_editor_plugin"):
		_scene_particles_tools.set_editor_plugin(plugin)


func _init_tools() -> void:
	if _initialized:
		return
	_initialized = true

	var base_path: String = get_script().resource_path.get_base_dir()
	var scene_tools_path := "%s/tools/scene_tools.gd" % base_path
	var resource_tools_path := "%s/tools/resource_tools.gd" % base_path
	var animation_tools_path := "%s/tools/animation_tools.gd" % base_path
	var scene_3d_tools_path := "%s/tools/scene_3d_tools.gd" % base_path
	var scene_physics_tools_path := "%s/tools/scene_physics_tools.gd" % base_path
	var scene_particles_tools_path := "%s/tools/scene_particles_tools.gd" % base_path

	if ResourceLoader.exists(scene_tools_path):
		var scene_script: Script = load(scene_tools_path)
		if scene_script:
			_scene_tools = scene_script.new()
			_scene_tools.name = "SceneTools"
			add_child(_scene_tools)

	if ResourceLoader.exists(resource_tools_path):
		var resource_script: Script = load(resource_tools_path)
		if resource_script:
			_resource_tools = resource_script.new()
			_resource_tools.name = "ResourceTools"
			add_child(_resource_tools)

	if ResourceLoader.exists(animation_tools_path):
		var animation_script: Script = load(animation_tools_path)
		if animation_script:
			_animation_tools = animation_script.new()
			_animation_tools.name = "AnimationTools"
			add_child(_animation_tools)

	if ResourceLoader.exists(scene_3d_tools_path):
		var scene_3d_script: Script = load(scene_3d_tools_path)
		if scene_3d_script:
			_scene_3d_tools = scene_3d_script.new()
			_scene_3d_tools.name = "Scene3DTools"
			add_child(_scene_3d_tools)

	if ResourceLoader.exists(scene_physics_tools_path):
		var scene_physics_script: Script = load(scene_physics_tools_path)
		if scene_physics_script:
			_scene_physics_tools = scene_physics_script.new()
			_scene_physics_tools.name = "ScenePhysicsTools"
			add_child(_scene_physics_tools)

	if ResourceLoader.exists(scene_particles_tools_path):
		var scene_particles_script: Script = load(scene_particles_tools_path)
		if scene_particles_script:
			_scene_particles_tools = scene_particles_script.new()
			_scene_particles_tools.name = "SceneParticlesTools"
			add_child(_scene_particles_tools)

	_tool_map = {
		# Scene tools
		"create_scene": [_scene_tools, "create_scene"],
		"list_scene_nodes": [_scene_tools, "list_scene_nodes"],
		"add_node": [_scene_tools, "add_node"],
		"delete_node": [_scene_tools, "delete_node"],
		"duplicate_node": [_scene_tools, "duplicate_node"],
		"reparent_node": [_scene_tools, "reparent_node"],
		"set_node_properties": [_scene_tools, "set_node_properties"],
		"get_node_properties": [_scene_tools, "get_node_properties"],
		"load_sprite": [_scene_tools, "load_sprite"],
		"save_scene": [_scene_tools, "save_scene"],
		"connect_signal": [_scene_tools, "connect_signal"],
		"disconnect_signal": [_scene_tools, "disconnect_signal"],
		"list_connections": [_scene_tools, "list_connections"],

		# Resource tools
		"create_resource": [_resource_tools, "create_resource"],
		"modify_resource": [_resource_tools, "modify_resource"],
		"create_material": [_resource_tools, "create_material"],
		"create_shader": [_resource_tools, "create_shader"],
		"create_tileset": [_resource_tools, "create_tileset"],
		"set_tilemap_cells": [_resource_tools, "set_tilemap_cells"],
		"set_theme_color": [_resource_tools, "set_theme_color"],
		"set_theme_font_size": [_resource_tools, "set_theme_font_size"],
		"apply_theme_shader": [_resource_tools, "apply_theme_shader"],

		# Animation tools
		"create_animation": [_animation_tools, "create_animation"],
		"add_animation_track": [_animation_tools, "add_animation_track"],
		"create_animation_tree": [_animation_tools, "create_animation_tree"],
		"add_animation_state": [_animation_tools, "add_animation_state"],
		"connect_animation_states": [_animation_tools, "connect_animation_states"],
		"create_navigation_region": [_animation_tools, "create_navigation_region"],
		"create_navigation_agent": [_animation_tools, "create_navigation_agent"],

		# Scene 3D tools
		"add_mesh_instance": [_scene_3d_tools, "add_mesh_instance"],
		"setup_camera_3d": [_scene_3d_tools, "setup_camera_3d"],
		"setup_lighting": [_scene_3d_tools, "setup_lighting"],
		"setup_environment": [_scene_3d_tools, "setup_environment"],
		"set_material_3d": [_scene_3d_tools, "set_material_3d"],
		"add_gridmap": [_scene_3d_tools, "add_gridmap"],

		# Scene Physics tools
		"setup_collision": [_scene_physics_tools, "setup_collision"],
		"setup_physics_body": [_scene_physics_tools, "setup_physics_body"],
		"add_raycast": [_scene_physics_tools, "add_raycast"],
		"set_physics_layers": [_scene_physics_tools, "set_physics_layers"],
		"get_physics_layers": [_scene_physics_tools, "get_physics_layers"],
		"get_collision_info": [_scene_physics_tools, "get_collision_info"],

		# Scene Particles tools
		"create_particles": [_scene_particles_tools, "create_particles"],
		"set_particle_material": [_scene_particles_tools, "set_particle_material"],
		"set_particle_color_gradient": [_scene_particles_tools, "set_particle_color_gradient"],
		"apply_particle_preset": [_scene_particles_tools, "apply_particle_preset"],
		"get_particle_info": [_scene_particles_tools, "get_particle_info"],
	}


func execute_tool(tool_name: String, args: Dictionary) -> Dictionary:
	if not _tool_map.has(tool_name):
		return {"ok": false, "error": "Unknown tool: " + tool_name}

	var handler: Array = _tool_map[tool_name]
	var node: Node = handler[0]
	var method: String = handler[1]

	if node == null:
		return {"ok": false, "error": "Tool handler unavailable: " + tool_name}

	if not node.has_method(method):
		return {"ok": false, "error": "Tool method not found: %s.%s" % [node.name, method]}

	var result = node.call(method, args)
	if result is Dictionary:
		return result

	return {"ok": false, "error": "Invalid tool result from: " + tool_name}
