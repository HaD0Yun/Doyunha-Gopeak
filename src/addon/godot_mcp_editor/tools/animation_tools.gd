@tool
extends Node
class_name MCPAnimationTools

var _editor_plugin: EditorPlugin = null

func set_editor_plugin(plugin: EditorPlugin) -> void:
	_editor_plugin = plugin


# =============================================================================
# Shared helpers
# =============================================================================
func _ensure_res_path(path: String) -> String:
	if not path.begins_with("res://"): return "res://" + path
	return path

func _refresh_and_reload(scene_path: String) -> void:
	_refresh_filesystem()
	_reload_scene_in_editor(scene_path)

func _refresh_filesystem() -> void:
	if _editor_plugin:
		EditorInterface.get_resource_filesystem().scan()

func _reload_scene_in_editor(scene_path: String) -> void:
	if not _editor_plugin: return
	var edited = EditorInterface.get_edited_scene_root()
	if edited and edited.scene_file_path == scene_path:
		EditorInterface.reload_scene_from_path(scene_path)

func _load_scene(scene_path: String) -> Array:
	if not FileAccess.file_exists(scene_path):
		return [null, {"ok": false, "error": "Scene not found: " + scene_path}]
	var packed = load(scene_path) as PackedScene
	if not packed: return [null, {"ok": false, "error": "Failed to load: " + scene_path}]
	var root = packed.instantiate()
	if not root: return [null, {"ok": false, "error": "Failed to instantiate: " + scene_path}]
	return [root, {}]

func _save_scene(scene_root: Node, scene_path: String) -> Dictionary:
	var packed = PackedScene.new()
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
	if path == "." or path.is_empty(): return root
	return root.get_node_or_null(path)

func _parse_value(value):
	if typeof(value) == TYPE_DICTIONARY:
		if value.has("type") or value.has("_type"):
			var t = value.get("type", value.get("_type", ""))
			match t:
				"Vector2": return Vector2(value.get("x",0), value.get("y",0))
				"Vector3": return Vector3(value.get("x",0), value.get("y",0), value.get("z",0))
				"Color": return Color(value.get("r",1), value.get("g",1), value.get("b",1), value.get("a",1))
	if typeof(value) == TYPE_ARRAY:
		var result = []
		for item in value:
			result.append(_parse_value(item))
		return result
	return value

func _parse_json_maybe(value):
	if typeof(value) != TYPE_STRING:
		return value
	var parsed = JSON.parse_string(value)
	if parsed == null and value != "null":
		return value
	return parsed

func _parse_method_args(raw_args: Array) -> Array:
	var parsed_args: Array = []
	for raw_arg in raw_args:
		var parsed = _parse_json_maybe(raw_arg)
		parsed_args.append(_parse_value(parsed))
	return parsed_args

func _get_default_animation_library(player: AnimationPlayer) -> AnimationLibrary:
	var anim_lib: AnimationLibrary = player.get_animation_library("")
	if anim_lib:
		return anim_lib
	anim_lib = AnimationLibrary.new()
	var add_lib_err := player.add_animation_library("", anim_lib)
	if add_lib_err != OK:
		return null
	return anim_lib

func _get_state_machine(anim_tree: AnimationTree, state_machine_path: String = "") -> AnimationNodeStateMachine:
	if not anim_tree:
		return null
	if state_machine_path.is_empty() or state_machine_path == "root":
		return anim_tree.tree_root as AnimationNodeStateMachine

	var current = anim_tree.tree_root
	for segment in state_machine_path.split("/", false):
		if String(segment).is_empty():
			continue
		if current == null or not current.has_method("get_node"):
			return null
		current = current.call("get_node", StringName(segment))
	var sm = current as AnimationNodeStateMachine
	if sm == null:
		return null
	return sm


# =============================================================================
# create_animation
# =============================================================================
func create_animation(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var player_node_path: String = str(args.get("playerNodePath", "."))
	var animation_name: String = str(args.get("animationName", ""))
	var loop_mode_name: String = str(args.get("loopMode", "none"))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if animation_name.strip_edges().is_empty():
		return {"ok": false, "error": "Missing animationName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var player = _find_node(scene_root, player_node_path) as AnimationPlayer
	if not player:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationPlayer not found at: " + player_node_path}

	var anim_lib := _get_default_animation_library(player)
	if not anim_lib:
		scene_root.queue_free()
		return {"ok": false, "error": "Failed to create default AnimationLibrary"}
	if anim_lib.has_animation(StringName(animation_name)):
		scene_root.queue_free()
		return {"ok": false, "error": "Animation already exists: " + animation_name}

	var loop_mode := Animation.LOOP_NONE
	match loop_mode_name:
		"linear": loop_mode = Animation.LOOP_LINEAR
		"pingpong": loop_mode = Animation.LOOP_PINGPONG
		_:
			loop_mode_name = "none"
			loop_mode = Animation.LOOP_NONE

	var anim = Animation.new()
	anim.length = float(args.get("length", 1.0))
	anim.loop_mode = loop_mode
	anim.step = float(args.get("step", 0.1))

	var add_err := anim_lib.add_animation(StringName(animation_name), anim)
	if add_err != OK:
		scene_root.queue_free()
		return {"ok": false, "error": "Failed to add animation: " + str(add_err)}

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {
		"ok": true,
		"animationName": animation_name,
		"length": anim.length,
		"loopMode": loop_mode_name,
	}


# =============================================================================
# add_animation_track
# =============================================================================
func add_animation_track(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var player_node_path: String = str(args.get("playerNodePath", "."))
	var animation_name: String = str(args.get("animationName", ""))
	var track: Dictionary = args.get("track", {})

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if animation_name.strip_edges().is_empty():
		return {"ok": false, "error": "Missing animationName"}
	if track.is_empty():
		return {"ok": false, "error": "Missing track"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var player = _find_node(scene_root, player_node_path) as AnimationPlayer
	if not player:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationPlayer not found at: " + player_node_path}

	var anim_lib: AnimationLibrary = player.get_animation_library("")
	if not anim_lib:
		scene_root.queue_free()
		return {"ok": false, "error": "Default AnimationLibrary not found"}

	var anim: Animation = anim_lib.get_animation(StringName(animation_name))
	if not anim:
		scene_root.queue_free()
		return {"ok": false, "error": "Animation not found: " + animation_name}

	var track_type: String = str(track.get("type", ""))
	var track_idx := -1
	var keyframes: Array = track.get("keyframes", [])

	match track_type:
		"property":
			var node_path_str: String = str(track.get("nodePath", ""))
			var prop_name: String = str(track.get("property", ""))
			if prop_name.is_empty():
				scene_root.queue_free()
				return {"ok": false, "error": "track.property is required for property track"}
			track_idx = anim.add_track(Animation.TYPE_VALUE)
			anim.track_set_path(track_idx, NodePath(node_path_str + ":" + prop_name))
			for keyframe in keyframes:
				if typeof(keyframe) != TYPE_DICTIONARY:
					continue
				var raw_value = keyframe.get("value")
				var parsed_value = _parse_json_maybe(raw_value) if typeof(raw_value) == TYPE_STRING else raw_value
				anim.track_insert_key(track_idx, float(keyframe.get("time", 0.0)), _parse_value(parsed_value))

		"method":
			var method_node_path: String = str(track.get("nodePath", ""))
			var method_name: String = str(track.get("method", ""))
			if method_name.is_empty():
				scene_root.queue_free()
				return {"ok": false, "error": "track.method is required for method track"}
			track_idx = anim.add_track(Animation.TYPE_METHOD)
			anim.track_set_path(track_idx, NodePath(method_node_path))
			for keyframe in keyframes:
				if typeof(keyframe) != TYPE_DICTIONARY:
					continue
				anim.track_insert_key(
					track_idx,
					float(keyframe.get("time", 0.0)),
					{
						"method": method_name,
						"args": _parse_method_args(keyframe.get("args", [])),
					}
				)

		_:
			scene_root.queue_free()
			return {"ok": false, "error": "Unsupported track.type: " + track_type}

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "trackType": track_type, "trackIndex": track_idx}


# =============================================================================
# create_animation_tree
# =============================================================================
func create_animation_tree(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var parent_path: String = str(args.get("parentPath", "."))
	var node_name: String = str(args.get("nodeName", "AnimationTree"))
	var anim_player_path: String = str(args.get("animPlayerPath", ""))
	var root_type: String = str(args.get("rootType", "StateMachine"))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_player_path.is_empty():
		return {"ok": false, "error": "Missing animPlayerPath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var parent = _find_node(scene_root, parent_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_path}

	var anim_tree := AnimationTree.new()
	anim_tree.name = node_name
	anim_tree.anim_player = NodePath(anim_player_path)

	var root = null
	match root_type:
		"StateMachine": root = AnimationNodeStateMachine.new()
		"BlendTree": root = AnimationNodeBlendTree.new()
		"BlendSpace1D": root = AnimationNodeBlendSpace1D.new()
		"BlendSpace2D": root = AnimationNodeBlendSpace2D.new()
		_:
			scene_root.queue_free()
			return {"ok": false, "error": "Unsupported rootType: " + root_type}

	anim_tree.tree_root = root
	parent.add_child(anim_tree)
	anim_tree.owner = scene_root

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodeName": node_name, "rootType": root_type}


# =============================================================================
# add_animation_state
# =============================================================================
func add_animation_state(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var state_name: String = str(args.get("stateName", ""))
	var animation_name: String = str(args.get("animationName", ""))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if state_name.is_empty():
		return {"ok": false, "error": "Missing stateName"}
	if animation_name.is_empty():
		return {"ok": false, "error": "Missing animationName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	var anim_node := AnimationNodeAnimation.new()
	anim_node.animation = StringName(animation_name)
	sm.add_node(StringName(state_name), anim_node)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "stateName": state_name, "animationName": animation_name}


# =============================================================================
# connect_animation_states
# =============================================================================
func connect_animation_states(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var from_state: String = str(args.get("fromState", ""))
	var to_state: String = str(args.get("toState", ""))
	var transition_type: String = str(args.get("transitionType", "immediate"))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))
	var advance_condition: String = str(args.get("advanceCondition", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if from_state.is_empty() or to_state.is_empty():
		return {"ok": false, "error": "Missing fromState or toState"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	var transition := AnimationNodeStateMachineTransition.new()
	match transition_type:
		"sync": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_SYNC
		"at_end": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		"immediate": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE
		_:
			scene_root.queue_free()
			return {"ok": false, "error": "Unsupported transitionType: " + transition_type}

	if not advance_condition.is_empty():
		transition.advance_condition = StringName(advance_condition)

	sm.add_transition(StringName(from_state), StringName(to_state), transition)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "from": from_state, "to": to_state}


# =============================================================================
# create_navigation_region
# =============================================================================
func create_navigation_region(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var parent_path: String = str(args.get("parentPath", "."))
	var node_name: String = str(args.get("nodeName", "NavigationRegion"))
	var is_3d: bool = bool(args.get("is3D", false))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var parent = _find_node(scene_root, parent_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_path}

	var nav: Node = null
	if is_3d:
		var nav3d := NavigationRegion3D.new()
		nav3d.navigation_mesh = NavigationMesh.new()
		nav = nav3d
	else:
		var nav2d := NavigationRegion2D.new()
		nav2d.navigation_polygon = NavigationPolygon.new()
		nav = nav2d

	nav.name = node_name
	parent.add_child(nav)
	nav.owner = scene_root

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodeName": node_name, "is3D": is_3d}


# =============================================================================
# create_navigation_agent
# =============================================================================
func create_navigation_agent(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var parent_path: String = str(args.get("parentPath", "."))
	var node_name: String = str(args.get("nodeName", "NavigationAgent"))
	var is_3d: bool = bool(args.get("is3D", false))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var parent = _find_node(scene_root, parent_path)
	if not parent:
		scene_root.queue_free()
		return {"ok": false, "error": "Parent node not found: " + parent_path}

	var agent: Node = null
	if is_3d:
		var agent3d := NavigationAgent3D.new()
		agent3d.name = node_name
		if args.has("pathDesiredDistance") and args.get("pathDesiredDistance") != null:
			agent3d.path_desired_distance = float(args.get("pathDesiredDistance"))
		if args.has("targetDesiredDistance") and args.get("targetDesiredDistance") != null:
			agent3d.target_desired_distance = float(args.get("targetDesiredDistance"))
		agent = agent3d
	else:
		var agent2d := NavigationAgent2D.new()
		agent2d.name = node_name
		if args.has("pathDesiredDistance") and args.get("pathDesiredDistance") != null:
			agent2d.path_desired_distance = float(args.get("pathDesiredDistance"))
		if args.has("targetDesiredDistance") and args.get("targetDesiredDistance") != null:
			agent2d.target_desired_distance = float(args.get("targetDesiredDistance"))
		agent = agent2d

	parent.add_child(agent)
	agent.owner = scene_root

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodeName": node_name, "is3D": is_3d}


# =============================================================================
# get_animation_tree_structure
# =============================================================================
func get_animation_tree_structure(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var root = anim_tree.tree_root
	if not root:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree has no tree_root"}

	var result := {"ok": true, "rootType": root.get_class(), "nodes": []}

	if root is AnimationNodeStateMachine:
		result["states"] = []
		var state_names: Array = root.get_node_list()
		for state_name in state_names:
			var child: AnimationNode = root.get_node(state_name)
			var state_info := {"name": str(state_name), "type": child.get_class()}
			if child.has_method("get_animation"):
				state_info["animation"] = str(child.call("get_animation"))
			result["states"].append(state_info)
		result["transitions"] = []
		var switch_mode_names := {
			AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE: "immediate",
			AnimationNodeStateMachineTransition.SWITCH_MODE_SYNC: "sync",
			AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END: "at_end",
		}
		for i in range(root.get_transition_count()):
			var t: AnimationNodeStateMachineTransition = root.get_transition(i)
			result["transitions"].append({
				"from": str(root.get_transition_from(i)),
				"to": str(root.get_transition_to(i)),
				"switchMode": switch_mode_names.get(t.switch_mode, str(t.switch_mode)),
			})
	elif root is AnimationNodeBlendTree:
		result["blendNodes"] = []
		var node_names: Array = root.get_node_list()
		for blend_node_name in node_names:
			var child: AnimationNode = root.get_node(blend_node_name)
			var pos: Vector2 = root.get_node_position(blend_node_name)
			result["blendNodes"].append({
				"name": str(blend_node_name),
				"type": child.get_class(),
				"position": {"x": pos.x, "y": pos.y},
			})
		result["connections"] = []
		var conns: Array = root.get_node_connections()
		for c in conns:
			result["connections"].append({
				"from": str(c.get("output_node", "")),
				"to": str(c.get("input_node", "")),
				"toPort": c.get("input_index", 0),
			})

	scene_root.queue_free()
	return result


# =============================================================================
# add_state_machine_state
# =============================================================================
func add_state_machine_state(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var state_name: String = str(args.get("stateName", ""))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))
	var animation_name: String = str(args.get("animationName", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if state_name.is_empty():
		return {"ok": false, "error": "Missing stateName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	if sm.has_node(StringName(state_name)):
		scene_root.queue_free()
		return {"ok": false, "error": "State already exists: " + state_name}

	var anim_node: AnimationNodeAnimation
	if not animation_name.is_empty():
		anim_node = AnimationNodeAnimation.new()
		anim_node.animation = StringName(animation_name)
	else:
		anim_node = AnimationNodeAnimation.new()

	sm.add_node(StringName(state_name), anim_node)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "stateName": state_name, "animationName": animation_name}


# =============================================================================
# remove_state_machine_state
# =============================================================================
func remove_state_machine_state(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var state_name: String = str(args.get("stateName", ""))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if state_name.is_empty():
		return {"ok": false, "error": "Missing stateName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	if not sm.has_node(StringName(state_name)):
		scene_root.queue_free()
		return {"ok": false, "error": "State not found: " + state_name}

	sm.remove_node(StringName(state_name))

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "removed": state_name}


# =============================================================================
# add_state_machine_transition
# =============================================================================
func add_state_machine_transition(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var from_state: String = str(args.get("fromState", ""))
	var to_state: String = str(args.get("toState", ""))
	var transition_type: String = str(args.get("transitionType", "immediate"))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))
	var advance_condition: String = str(args.get("advanceCondition", ""))
	var priority: int = int(args.get("priority", 0))
	var auto_advance: bool = bool(args.get("autoAdvance", true))
	var crossfade: float = float(args.get("crossfade", 0.0))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if from_state.is_empty() or to_state.is_empty():
		return {"ok": false, "error": "Missing fromState or toState"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	var transition := AnimationNodeStateMachineTransition.new()
	match transition_type:
		"sync": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_SYNC
		"at_end": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_AT_END
		"immediate": transition.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE
		_:
			scene_root.queue_free()
			return {"ok": false, "error": "Unsupported transitionType: " + transition_type}

	transition.priority = priority
	transition.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_ENABLED if auto_advance else AnimationNodeStateMachineTransition.ADVANCE_MODE_DISABLED
	transition.xfade_time = crossfade
	if not advance_condition.is_empty():
		transition.advance_condition = StringName(advance_condition)

	sm.add_transition(StringName(from_state), StringName(to_state), transition)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "from": from_state, "to": to_state, "transitionType": transition_type}


# =============================================================================
# remove_state_machine_transition
# =============================================================================
func remove_state_machine_transition(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var from_state: String = str(args.get("fromState", ""))
	var to_state: String = str(args.get("toState", ""))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if from_state.is_empty() or to_state.is_empty():
		return {"ok": false, "error": "Missing fromState or toState"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var sm := _get_state_machine(anim_tree, state_machine_path)
	if not sm:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationNodeStateMachine not found"}

	var removed := false
	for i in range(sm.get_transition_count() - 1, -1, -1):
		if sm.get_transition_from(i) == StringName(from_state) and sm.get_transition_to(i) == StringName(to_state):
			sm.remove_transition(StringName(from_state), StringName(to_state))
			removed = true
			break

	if not removed:
		scene_root.queue_free()
		return {"ok": false, "error": "Transition not found from '" + from_state + "' to '" + to_state + "'"}

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "from": from_state, "to": to_state, "removed": true}


# =============================================================================
# set_blend_tree_node
# =============================================================================
func set_blend_tree_node(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var node_name: String = str(args.get("nodeName", ""))
	var node_type: String = str(args.get("nodeType", ""))
	var position: Dictionary = args.get("position", {"x": 0, "y": 0})
	var inputs: Array = args.get("inputs", [])
	var blend: float = float(args.get("blend", 0.5))
	var state_machine_path: String = str(args.get("stateMachinePath", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if node_name.is_empty():
		return {"ok": false, "error": "Missing nodeName"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var root = anim_tree.tree_root as AnimationNodeBlendTree
	if not root:
		scene_root.queue_free()
		return {"ok": false, "error": "tree_root is not an AnimationNodeBlendTree"}

	if node_type.is_empty():
		if root.has_node(StringName(node_name)):
			var pos := Vector2(float(position.get("x", 0)), float(position.get("y", 0)))
			root.set_node_position(StringName(node_name), pos)
			var save_err := _save_scene(scene_root, scene_path)
			if not save_err.is_empty():
				return save_err
			return {"ok": true, "nodeName": node_name, "updated": true}
		scene_root.queue_free()
		return {"ok": false, "error": "Node not found and no nodeType specified"}

	var new_node: AnimationNode = null
	match node_type:
		"Animation": new_node = AnimationNodeAnimation.new()
		"Blend2": new_node = AnimationNodeBlend2.new()
		"Blend3": new_node = AnimationNodeBlend3.new()
		"BlendSpace1D": new_node = AnimationNodeBlendSpace1D.new()
		"BlendSpace2D": new_node = AnimationNodeBlendSpace2D.new()
		"OneShot", "ClipOneShot": new_node = AnimationNodeOneShot.new()
		"StateMachine": new_node = AnimationNodeStateMachine.new()
		"TimeSeek": new_node = AnimationNodeTimeSeek.new()
		"TimeScale": new_node = AnimationNodeTimeScale.new()
		"Transition": new_node = AnimationNodeTransition.new()
		_:
			scene_root.queue_free()
			return {"ok": false, "error": "Unsupported nodeType: " + node_type}

	var pos := Vector2(float(position.get("x", 0)), float(position.get("y", 0)))
	root.add_node(StringName(node_name), new_node, pos)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "nodeName": node_name, "nodeType": node_type}


# =============================================================================
# set_tree_parameter
# =============================================================================
func set_tree_parameter(args: Dictionary) -> Dictionary:
	var scene_path: String = _ensure_res_path(str(args.get("scenePath", "")))
	var anim_tree_path: String = str(args.get("animTreePath", ""))
	var parameter_path: String = str(args.get("parameterPath", ""))
	var value = args.get("value")
	var value_type: String = str(args.get("valueType", ""))

	if scene_path.strip_edges() == "res://":
		return {"ok": false, "error": "Missing scenePath"}
	if anim_tree_path.is_empty():
		return {"ok": false, "error": "Missing animTreePath"}
	if parameter_path.is_empty():
		return {"ok": false, "error": "Missing parameterPath"}

	var loaded := _load_scene(scene_path)
	if not loaded[1].is_empty():
		return loaded[1]

	var scene_root: Node = loaded[0]
	var anim_tree = _find_node(scene_root, anim_tree_path) as AnimationTree
	if not anim_tree:
		scene_root.queue_free()
		return {"ok": false, "error": "AnimationTree not found at: " + anim_tree_path}

	var parsed_value = _parse_json_maybe(value) if typeof(value) == TYPE_STRING else value
	parsed_value = _parse_value(parsed_value)

	anim_tree.set(parameter_path, parsed_value)

	var save_err := _save_scene(scene_root, scene_path)
	if not save_err.is_empty():
		return save_err

	return {"ok": true, "parameterPath": parameter_path, "value": parsed_value}
