extends Node

## MCP Runtime Autoload
## This singleton runs in the game and provides runtime inspection capabilities.
## It starts a TCP server that the MCP server can connect to.

const DEFAULT_PORT = 7777
const PROTOCOL_VERSION = "1.0"

var _server: TCPServer
var _clients: Array[StreamPeerTCP] = []
var _port: int = DEFAULT_PORT
var _enabled: bool = true
var _watched_signals: Dictionary = {}  # { "node_path:signal_name": callable }
var _recordings: Dictionary = {}  # { name: { events: Array, started_frame: int, stopped_frame: int } }
var _active_recording: String = ""
var _input_event_recorder: Callable
var _replays: Dictionary = {}  # { name: { events: Array, start_frame: int, speed: String } }

signal client_connected
signal client_disconnected
signal command_received(command: String, params: Dictionary)


func _ready() -> void:
	name = "MCPRuntime"
	_start_server()
	print("[MCP Runtime] Autoload ready, server starting on port %d" % _port)


func _process(_delta: float) -> void:
	if not _enabled or _server == null:
		return

	_advance_replays()

	# Accept new connections
	if _server.is_connection_available():
		var client = _server.take_connection()
		if client:
			_clients.append(client)
			print("[MCP Runtime] Client connected")
			client_connected.emit()
			_send_welcome(client)
	
	# Process client messages
	var clients_to_remove: Array[StreamPeerTCP] = []
	for client in _clients:
		if client.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			clients_to_remove.append(client)
			continue
		
		client.poll()
		if client.get_status() != StreamPeerTCP.STATUS_CONNECTED:
			clients_to_remove.append(client)
			continue
		var available = client.get_available_bytes()
		if available > 0:
			var data = client.get_utf8_string(available)
			_handle_message(client, data)
	
	# Remove disconnected clients
	for client in clients_to_remove:
		_clients.erase(client)
		print("[MCP Runtime] Client disconnected")
		client_disconnected.emit()


func _start_server() -> void:
	_server = TCPServer.new()
	var error = _server.listen(_port)
	if error != OK:
		push_error("[MCP Runtime] Failed to start server on port %d: %s" % [_port, error])
		_enabled = false
	else:
		print("[MCP Runtime] Server listening on port %d" % _port)


func _send_welcome(client: StreamPeerTCP) -> void:
	var welcome = {
		"type": "welcome",
		"protocol_version": PROTOCOL_VERSION,
		"godot_version": Engine.get_version_info(),
		"project_name": ProjectSettings.get_setting("application/config/name", "Unknown")
	}
	_send_response(client, welcome)


func _handle_message(client: StreamPeerTCP, data: String) -> void:
	var json = JSON.new()
	var error = json.parse(data)
	if error != OK:
		_send_error(client, "Invalid JSON: " + json.get_error_message())
		return
	
	var message = json.get_data()
	if not message is Dictionary:
		_send_error(client, "Message must be an object")
		return
	
	var command = message.get("command", "")
	var params = message.get("params", {})
	var request_id = message.get("id", null)
	
	command_received.emit(command, params)
	
	var result = _execute_command(command, params)
	if request_id != null:
		result["id"] = request_id
	
	_send_response(client, result)


func _execute_command(command: String, params: Dictionary) -> Dictionary:
	match command:
		"ping":
			return {"type": "pong", "timestamp": Time.get_unix_time_from_system()}
		
		"get_tree":
			return _cmd_get_tree(params)
		
		"get_node":
			return _cmd_get_node(params)
		
		"set_property":
			return _cmd_set_property(params)
		
		"call_method":
			return _cmd_call_method(params)
		
		"get_metrics":
			return _cmd_get_metrics(params)
		
		"capture_screenshot":
			return _cmd_capture_screenshot(params)
		
		"capture_viewport":
			return _cmd_capture_viewport(params)
		
		"inject_action":
			return _cmd_inject_action(params)
		
		"inject_key":
			return _cmd_inject_key(params)
		
		"inject_mouse_click":
			return _cmd_inject_mouse_click(params)
		
		"inject_mouse_motion":
			return _cmd_inject_mouse_motion(params)
		
		"watch_signal":
			return _cmd_watch_signal(params)
		
		"unwatch_signal":
			return _cmd_unwatch_signal(params)

		"wait_for_node":
			return _cmd_wait_for_node(params)

		"batch_get_properties":
			return _cmd_batch_get_properties(params)

		"monitor_properties":
			return _cmd_monitor_properties(params)

		"find_ui_elements":
			return _cmd_find_ui_elements(params)

		"click_button_by_text":
			return _cmd_click_button_by_text(params)

		"capture_frames":
			return _cmd_capture_frames(params)

		"get_label_texts":
			return _cmd_get_label_texts(params)

		"get_performance_monitors":
			return _cmd_get_performance_monitors(params)

		"start_recording":
			return _cmd_start_recording(params)

		"stop_recording":
			return _cmd_stop_recording(params)

		"replay_recording":
			return _cmd_replay_recording(params)

		"list_recordings":
			return _cmd_list_recordings(params)

		"get_engine_state":
			return _cmd_get_engine_state(params)

		_:
			return {"type": "error", "message": "Unknown command: " + command}


func _cmd_get_tree(params: Dictionary) -> Dictionary:
	var root_path = params.get("root", "/root")
	var max_depth = params.get("depth", 3)
	var include_properties = params.get("include_properties", false)
	
	var root = get_tree().root.get_node_or_null(root_path)
	if root == null:
		return {"type": "error", "message": "Node not found: " + root_path}
	
	return {
		"type": "tree",
		"root": _serialize_node_tree(root, 0, max_depth, include_properties)
	}


func _cmd_get_node(params: Dictionary) -> Dictionary:
	var node_path = params.get("path", "")
	if node_path.is_empty():
		return {"type": "error", "message": "Node path required"}
	
	var node = get_tree().root.get_node_or_null(node_path)
	if node == null:
		return {"type": "error", "message": "Node not found: " + node_path}
	
	return {
		"type": "node",
		"data": _serialize_node(node, true)
	}


func _cmd_set_property(params: Dictionary) -> Dictionary:
	var node_path = params.get("path", "")
	var property = params.get("property", "")
	var value = params.get("value")
	
	if node_path.is_empty() or property.is_empty():
		return {"type": "error", "message": "Node path and property required"}
	
	var node = get_tree().root.get_node_or_null(node_path)
	if node == null:
		return {"type": "error", "message": "Node not found: " + node_path}
	
	var old_value = node.get(property)
	var set_result = node.set(property, _deserialize_value(value))
	if set_result != OK:
		return {"type": "error", "message": "Failed to set property '" + property + "' on node at " + node_path}

	return {
		"type": "property_set",
		"path": node_path,
		"property": property,
		"old_value": _serialize_value(old_value),
		"new_value": _serialize_value(node.get(property))
	}


func _cmd_call_method(params: Dictionary) -> Dictionary:
	var node_path = params.get("path", "")
	var method = params.get("method", "")
	var args = params.get("args", [])
	
	if node_path.is_empty() or method.is_empty():
		return {"type": "error", "message": "Node path and method required"}
	
	var node = get_tree().root.get_node_or_null(node_path)
	if node == null:
		return {"type": "error", "message": "Node not found: " + node_path}
	
	if not node.has_method(method):
		return {"type": "error", "message": "Method not found: " + method}
	
	var deserialized_args = []
	for arg in args:
		deserialized_args.append(_deserialize_value(arg))

	var result = null
	var call_ok = true
	if node.has_method(method):
		result = node.callv(method, deserialized_args)
	else:
		call_ok = false

	return {
		"type": "method_result",
		"path": node_path,
		"method": method,
		"result": _serialize_value(result),
		"ok": call_ok
	}


func _cmd_get_metrics(params: Dictionary) -> Dictionary:
	var metrics = params.get("metrics", [])
	var result = {
		"type": "metrics",
		"data": {}
	}
	
	# Always include basic metrics
	result["data"]["fps"] = Engine.get_frames_per_second()
	result["data"]["frame_time"] = Performance.get_monitor(Performance.TIME_PROCESS)
	result["data"]["physics_time"] = Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	
	# Memory metrics
	result["data"]["memory_static"] = Performance.get_monitor(Performance.MEMORY_STATIC)
	result["data"]["memory_static_max"] = Performance.get_monitor(Performance.MEMORY_STATIC_MAX)
	
	# Object counts
	result["data"]["object_count"] = Performance.get_monitor(Performance.OBJECT_COUNT)
	result["data"]["object_resource_count"] = Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)
	result["data"]["object_node_count"] = Performance.get_monitor(Performance.OBJECT_NODE_COUNT)
	result["data"]["object_orphan_node_count"] = Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)
	
	# Render metrics
	result["data"]["render_total_objects"] = Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)
	result["data"]["render_total_primitives"] = Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
	result["data"]["render_total_draw_calls"] = Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
	
	return result


func _cmd_capture_screenshot(params: Dictionary) -> Dictionary:
	var viewport = get_viewport()
	if viewport == null:
		return {"type": "error", "message": "No viewport available"}
	
	var viewport_texture = viewport.get_texture()
	if viewport_texture == null:
		return {"type": "error", "message": "No viewport texture available"}
	
	var image = viewport_texture.get_image()
	if image == null:
		return {"type": "error", "message": "Failed to capture viewport image"}
	
	var width = int(params.get("width", 0))
	var height = int(params.get("height", 0))
	if width > 0 and height > 0:
		image.resize(width, height)
	
	var png_bytes = image.save_png_to_buffer()
	if png_bytes.is_empty():
		return {"type": "error", "message": "Failed to encode screenshot as PNG"}
	
	var base64_str = Marshalls.raw_to_base64(png_bytes)
	
	return {
		"type": "screenshot",
		"format": "png",
		"encoding": "base64",
		"width": image.get_width(),
		"height": image.get_height(),
		"data": base64_str
	}


func _cmd_capture_viewport(params: Dictionary) -> Dictionary:
	return _cmd_capture_screenshot(params)


func _cmd_inject_action(params: Dictionary) -> Dictionary:
	var action = String(params.get("action", ""))
	var pressed = bool(params.get("pressed", true))
	var strength = float(params.get("strength", 1.0))
	
	if action.is_empty():
		return {"type": "error", "message": "Action name required"}
	
	if not InputMap.has_action(action):
		return {"type": "error", "message": "Action not found: " + action}
	
	var event = InputEventAction.new()
	event.action = action
	event.pressed = pressed
	event.strength = strength
	Input.parse_input_event(event)
	
	return {
		"type": "input_injected",
		"input_type": "action",
		"action": action,
		"pressed": pressed
	}


func _cmd_inject_key(params: Dictionary) -> Dictionary:
	var keycode = int(params.get("keycode", 0))
	var pressed = bool(params.get("pressed", true))
	var key_label = String(params.get("key_label", ""))
	
	var event = InputEventKey.new()
	event.pressed = pressed
	
	if not key_label.is_empty():
		event.keycode = OS.find_keycode_from_string(key_label)
		if event.keycode == KEY_NONE:
			return {"type": "error", "message": "Invalid key_label: " + key_label}
	elif keycode > 0:
		event.keycode = keycode
	else:
		return {"type": "error", "message": "keycode or key_label required"}
	
	Input.parse_input_event(event)
	
	return {
		"type": "input_injected",
		"input_type": "key",
		"keycode": event.keycode,
		"pressed": pressed
	}


func _cmd_inject_mouse_click(params: Dictionary) -> Dictionary:
	var position = params.get("position", Vector2.ZERO)
	var button = int(params.get("button", MOUSE_BUTTON_LEFT))
	var pressed = bool(params.get("pressed", true))
	
	if position is Array:
		if position.size() < 2:
			return {"type": "error", "message": "position array must contain [x, y]"}
		position = Vector2(float(position[0]), float(position[1]))
	elif position is Vector2:
		position = position
	else:
		return {"type": "error", "message": "position must be Vector2 or [x, y]"}
	
	var event = InputEventMouseButton.new()
	event.position = position
	event.global_position = position
	event.button_index = button
	event.pressed = pressed
	Input.parse_input_event(event)
	
	return {
		"type": "input_injected",
		"input_type": "mouse_click",
		"position": [position.x, position.y],
		"button": button,
		"pressed": pressed
	}


func _cmd_inject_mouse_motion(params: Dictionary) -> Dictionary:
	var position = params.get("position", Vector2.ZERO)
	var relative = params.get("relative", Vector2.ZERO)
	
	if position is Array:
		if position.size() < 2:
			return {"type": "error", "message": "position array must contain [x, y]"}
		position = Vector2(float(position[0]), float(position[1]))
	elif position is Vector2:
		position = position
	else:
		return {"type": "error", "message": "position must be Vector2 or [x, y]"}
	
	if relative is Array:
		if relative.size() < 2:
			return {"type": "error", "message": "relative array must contain [x, y]"}
		relative = Vector2(float(relative[0]), float(relative[1]))
	elif relative is Vector2:
		relative = relative
	else:
		return {"type": "error", "message": "relative must be Vector2 or [x, y]"}
	
	var event = InputEventMouseMotion.new()
	event.position = position
	event.global_position = position
	event.relative = relative
	Input.parse_input_event(event)
	
	return {
		"type": "input_injected",
		"input_type": "mouse_motion",
		"position": [position.x, position.y],
		"relative": [relative.x, relative.y]
	}


func _cmd_watch_signal(params: Dictionary) -> Dictionary:
	var node_path = params.get("path", "")
	var signal_name = params.get("signal", "")
	
	if node_path.is_empty() or signal_name.is_empty():
		return {"type": "error", "message": "Node path and signal name required"}
	
	var node = get_tree().root.get_node_or_null(node_path)
	if node == null:
		return {"type": "error", "message": "Node not found: " + node_path}
	
	if not node.has_signal(signal_name):
		return {"type": "error", "message": "Signal not found: " + signal_name}
	
	var key = node_path + ":" + signal_name
	if _watched_signals.has(key):
		return {"type": "error", "message": "Signal already being watched"}
	
	var callable = func(args = []):
		_broadcast_signal_event(node_path, signal_name, args)
	
	node.connect(signal_name, callable)
	_watched_signals[key] = callable
	
	return {
		"type": "signal_watched",
		"path": node_path,
		"signal": signal_name
	}


func _cmd_unwatch_signal(params: Dictionary) -> Dictionary:
	var node_path = params.get("path", "")
	var signal_name = params.get("signal", "")
	
	var key = node_path + ":" + signal_name
	if not _watched_signals.has(key):
		return {"type": "error", "message": "Signal not being watched"}
	
	var node = get_tree().root.get_node_or_null(node_path)
	if node != null:
		node.disconnect(signal_name, _watched_signals[key])
	
	_watched_signals.erase(key)
	
	return {
		"type": "signal_unwatched",
		"path": node_path,
		"signal": signal_name
	}


func _broadcast_signal_event(node_path: String, signal_name: String, args: Array) -> void:
	var event = {
		"type": "signal_event",
		"path": node_path,
		"signal": signal_name,
		"args": []
	}
	for arg in args:
		event["args"].append(_serialize_value(arg))
	
	for client in _clients:
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_send_response(client, event)


func _serialize_node_tree(node: Node, depth: int, max_depth: int, include_properties: bool) -> Dictionary:
	var result = _serialize_node(node, include_properties)
	
	if depth < max_depth:
		var children = []
		for child in node.get_children():
			children.append(_serialize_node_tree(child, depth + 1, max_depth, include_properties))
		result["children"] = children
	
	return result


func _serialize_node(node: Node, include_properties: bool) -> Dictionary:
	var result = {
		"name": node.name,
		"type": node.get_class(),
		"path": str(node.get_path())
	}
	
	if node.get_script():
		result["script"] = node.get_script().resource_path
	
	if include_properties:
		result["properties"] = {}
		for prop in node.get_property_list():
			if prop["usage"] & PROPERTY_USAGE_STORAGE:
				var name = prop["name"]
				if not name.begins_with("_"):
					result["properties"][name] = _serialize_value(node.get(name))
	
	return result


func _serialize_value(value) -> Variant:
	if value == null:
		return null
	elif value is Vector2:
		return {"_type": "Vector2", "x": value.x, "y": value.y}
	elif value is Vector3:
		return {"_type": "Vector3", "x": value.x, "y": value.y, "z": value.z}
	elif value is Vector2i:
		return {"_type": "Vector2i", "x": value.x, "y": value.y}
	elif value is Vector3i:
		return {"_type": "Vector3i", "x": value.x, "y": value.y, "z": value.z}
	elif value is Color:
		return {"_type": "Color", "r": value.r, "g": value.g, "b": value.b, "a": value.a}
	elif value is Rect2:
		return {"_type": "Rect2", "position": _serialize_value(value.position), "size": _serialize_value(value.size)}
	elif value is Transform2D:
		return {"_type": "Transform2D", "origin": _serialize_value(value.origin), "x": _serialize_value(value.x), "y": _serialize_value(value.y)}
	elif value is NodePath:
		return {"_type": "NodePath", "path": str(value)}
	elif value is Resource:
		return {"_type": "Resource", "path": value.resource_path, "class": value.get_class()}
	elif value is Array:
		var arr = []
		for item in value:
			arr.append(_serialize_value(item))
		return arr
	elif value is Dictionary:
		var dict = {}
		for key in value:
			dict[str(key)] = _serialize_value(value[key])
		return dict
	elif value is Object:
		return {"_type": "Object", "class": value.get_class()}
	else:
		return value


func _deserialize_value(value) -> Variant:
	if value == null:
		return null
	elif value is Dictionary:
		if value.has("_type"):
			match value["_type"]:
				"Vector2":
					return Vector2(value.get("x", 0), value.get("y", 0))
				"Vector3":
					return Vector3(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Vector2i":
					return Vector2i(value.get("x", 0), value.get("y", 0))
				"Vector3i":
					return Vector3i(value.get("x", 0), value.get("y", 0), value.get("z", 0))
				"Color":
					return Color(value.get("r", 0), value.get("g", 0), value.get("b", 0), value.get("a", 1))
				"NodePath":
					return NodePath(value.get("path", ""))
				_:
					return value
		else:
			var dict = {}
			for key in value:
				dict[key] = _deserialize_value(value[key])
			return dict
	elif value is Array:
		var arr = []
		for item in value:
			arr.append(_deserialize_value(item))
		return arr
	else:
		return value


func _send_response(client: StreamPeerTCP, data: Dictionary) -> void:
	var json_str = JSON.stringify(data) + "\n"
	client.put_utf8_string(json_str)


func _send_error(client: StreamPeerTCP, message: String) -> void:
	_send_response(client, {"type": "error", "message": message})


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		_cleanup()


func _cleanup() -> void:
	for client in _clients:
		client.disconnect_from_host()
	_clients.clear()

	if _server:
		_server.stop()
		_server = null

	print("[MCP Runtime] Cleanup complete")


# ============================================================
# Phase 1 — closed-loop test primitives
# ============================================================

func _resolve_node_or_null(node_path: String) -> Node:
	if node_path.is_empty():
		return null
	return get_tree().root.get_node_or_null(node_path)


func _cmd_wait_for_node(params: Dictionary) -> Dictionary:
	# Best-effort single-poll resolution. The MCP server side handles retry/backoff —
	# this command simply reports whether the node currently exists/is ready, allowing
	# the server to drive the polling loop without holding the runtime _process busy.
	var node_path = String(params.get("path", ""))
	var require_inside_tree = bool(params.get("require_inside_tree", true))
	if node_path.is_empty():
		return {"type": "error", "message": "path required"}

	var node = _resolve_node_or_null(node_path)
	if node == null:
		return {
			"type": "wait_for_node",
			"path": node_path,
			"found": false,
			"inside_tree": false,
			"frame": Engine.get_process_frames(),
		}

	var inside = node.is_inside_tree()
	return {
		"type": "wait_for_node",
		"path": node_path,
		"found": true,
		"inside_tree": inside,
		"ready": inside or not require_inside_tree,
		"class": node.get_class(),
		"frame": Engine.get_process_frames(),
	}


func _cmd_batch_get_properties(params: Dictionary) -> Dictionary:
	var targets = params.get("targets", [])
	if not targets is Array:
		return {"type": "error", "message": "targets must be an array of {path, properties[]} entries"}

	var results: Array = []
	for entry in targets:
		if not entry is Dictionary:
			results.append({"error": "entry must be an object"})
			continue
		var path = String(entry.get("path", ""))
		var props = entry.get("properties", [])
		var node = _resolve_node_or_null(path)
		if node == null:
			results.append({"path": path, "found": false, "error": "node not found"})
			continue
		var values: Dictionary = {}
		if props is Array:
			for pname in props:
				var ps = String(pname)
				values[ps] = _serialize_value(node.get(ps))
		results.append({
			"path": path,
			"found": true,
			"class": node.get_class(),
			"values": values,
		})

	return {"type": "batch_get_properties", "targets": results, "frame": Engine.get_process_frames()}


func _cmd_monitor_properties(params: Dictionary) -> Dictionary:
	# Synchronous sampler — collects N samples spaced by sample_ms, blocks on the runtime
	# process until duration elapses. Caller should keep duration_ms reasonable (<= 5000ms).
	var node_paths = params.get("node_paths", [])
	var properties = params.get("properties", [])
	var duration_ms = int(params.get("duration_ms", 1000))
	var sample_hz = float(params.get("sample_hz", 30.0))

	if not node_paths is Array or node_paths.is_empty():
		return {"type": "error", "message": "node_paths must be a non-empty array"}
	if not properties is Array or properties.is_empty():
		return {"type": "error", "message": "properties must be a non-empty array"}

	duration_ms = clamp(duration_ms, 16, 10000)
	sample_hz = clamp(sample_hz, 1.0, 120.0)
	var sample_interval_ms = int(round(1000.0 / sample_hz))

	var samples: Array = []
	var start_us = Time.get_ticks_msec()
	var end_us = start_us + duration_ms

	while Time.get_ticks_msec() <= end_us:
		var sample := {
			"t_ms": Time.get_ticks_msec() - start_us,
			"frame": Engine.get_process_frames(),
			"nodes": {},
		}
		for raw_path in node_paths:
			var path = String(raw_path)
			var node = _resolve_node_or_null(path)
			if node == null:
				sample["nodes"][path] = {"found": false}
				continue
			var values: Dictionary = {}
			for raw_prop in properties:
				var p = String(raw_prop)
				values[p] = _serialize_value(node.get(p))
			sample["nodes"][path] = {"found": true, "values": values}
		samples.append(sample)
		OS.delay_msec(sample_interval_ms)

	return {
		"type": "monitor_properties",
		"duration_ms": duration_ms,
		"sample_hz": sample_hz,
		"samples": samples,
	}


func _collect_controls_recursive(node: Node, out: Array, max_count: int) -> void:
	if out.size() >= max_count:
		return
	if node is Control or node is BaseButton:
		out.append(node)
	for child in node.get_children():
		_collect_controls_recursive(child, out, max_count)


func _control_text(control: Node) -> String:
	if control == null:
		return ""
	# Buttons and labels expose `text`; some controls use placeholder/title.
	if "text" in control:
		var t = control.get("text")
		if typeof(t) == TYPE_STRING:
			return t
	if "title" in control:
		var t2 = control.get("title")
		if typeof(t2) == TYPE_STRING:
			return t2
	if "placeholder_text" in control:
		var p = control.get("placeholder_text")
		if typeof(p) == TYPE_STRING:
			return p
	return ""


func _cmd_find_ui_elements(params: Dictionary) -> Dictionary:
	var filter = String(params.get("filter", ""))
	var class_filter = String(params.get("class", ""))
	var visible_only = bool(params.get("visible_only", true))
	var max_results = int(params.get("max_results", 200))
	max_results = clamp(max_results, 1, 1000)

	var controls: Array = []
	_collect_controls_recursive(get_tree().root, controls, max_results * 4)

	var elements: Array = []
	var lower_filter = filter.to_lower()
	for ctrl in controls:
		if elements.size() >= max_results:
			break
		if not class_filter.is_empty() and not ctrl.is_class(class_filter):
			continue
		if visible_only and ctrl is CanvasItem and not ctrl.is_visible_in_tree():
			continue
		var text = _control_text(ctrl)
		if not lower_filter.is_empty() and not text.to_lower().contains(lower_filter):
			continue
		var rect_pos = Vector2.ZERO
		var rect_size = Vector2.ZERO
		if ctrl is Control:
			rect_pos = ctrl.get_global_position()
			rect_size = ctrl.size
		elements.append({
			"path": str(ctrl.get_path()),
			"name": ctrl.name,
			"class": ctrl.get_class(),
			"text": text,
			"position": [rect_pos.x, rect_pos.y],
			"size": [rect_size.x, rect_size.y],
			"visible": ctrl is CanvasItem and ctrl.is_visible_in_tree(),
			"is_button": ctrl is BaseButton,
		})

	return {"type": "ui_elements", "elements": elements}


func _cmd_click_button_by_text(params: Dictionary) -> Dictionary:
	var target_text = String(params.get("text", ""))
	var exact = bool(params.get("exact", false))
	var case_sensitive = bool(params.get("case_sensitive", false))

	if target_text.is_empty():
		return {"type": "error", "message": "text required"}

	var controls: Array = []
	_collect_controls_recursive(get_tree().root, controls, 5000)

	var needle = target_text if case_sensitive else target_text.to_lower()
	var match_node: Node = null
	for ctrl in controls:
		if not ctrl is BaseButton:
			continue
		if ctrl is CanvasItem and not ctrl.is_visible_in_tree():
			continue
		var text = _control_text(ctrl)
		var hay = text if case_sensitive else text.to_lower()
		if exact:
			if hay == needle:
				match_node = ctrl
				break
		else:
			if hay.contains(needle):
				match_node = ctrl
				break

	if match_node == null:
		return {"type": "click_result", "clicked": false, "reason": "no matching button"}

	# Trigger via emit_signal/`pressed` for headless reliability; fall back to input synth.
	if match_node is BaseButton:
		var btn := match_node as BaseButton
		if btn.has_signal("pressed"):
			btn.emit_signal("pressed")
		if btn.has_method("set_pressed_no_signal"):
			btn.set_pressed_no_signal(true)

	return {
		"type": "click_result",
		"clicked": true,
		"path": str(match_node.get_path()),
		"name": match_node.name,
		"text": _control_text(match_node),
	}


func _cmd_capture_frames(params: Dictionary) -> Dictionary:
	var count = int(params.get("count", 1))
	var interval_ms = int(params.get("interval_ms", 100))
	count = clamp(count, 1, 30)
	interval_ms = clamp(interval_ms, 0, 1000)

	var frames: Array = []
	for i in count:
		var shot = _cmd_capture_screenshot(params)
		if shot.get("type") == "screenshot":
			frames.append({
				"index": i,
				"frame": Engine.get_process_frames(),
				"width": shot.get("width", 0),
				"height": shot.get("height", 0),
				"data": shot.get("data", ""),
			})
		else:
			frames.append({"index": i, "error": shot.get("message", "capture failed")})
		if i < count - 1 and interval_ms > 0:
			OS.delay_msec(interval_ms)

	return {"type": "frames", "format": "png", "encoding": "base64", "frames": frames}


func _collect_labels_recursive(node: Node, out: Array, max_count: int) -> void:
	if out.size() >= max_count:
		return
	if node is Label or node is RichTextLabel or node is Button or node is LineEdit or node is TextEdit or node is AcceptDialog:
		out.append(node)
	for child in node.get_children():
		_collect_labels_recursive(child, out, max_count)


func _cmd_get_label_texts(params: Dictionary) -> Dictionary:
	var visible_only = bool(params.get("visible_only", true))
	var max_results = int(params.get("max_results", 500))
	max_results = clamp(max_results, 1, 5000)

	var nodes: Array = []
	_collect_labels_recursive(get_tree().root, nodes, max_results * 4)

	var labels: Array = []
	for n in nodes:
		if labels.size() >= max_results:
			break
		if visible_only and n is CanvasItem and not n.is_visible_in_tree():
			continue
		var text = ""
		if n is RichTextLabel:
			text = n.get_parsed_text() if n.has_method("get_parsed_text") else String(n.text)
		else:
			text = _control_text(n)
		if text.is_empty():
			continue
		labels.append({
			"path": str(n.get_path()),
			"class": n.get_class(),
			"text": text,
		})

	return {"type": "label_texts", "labels": labels}


func _cmd_get_performance_monitors(params: Dictionary) -> Dictionary:
	# Returns a map of named monitor → numeric value. If `names` is empty, returns the
	# canonical built-in set (mirrors get_metrics + adds a few). Custom monitors registered
	# via Performance.add_custom_monitor are also addressable by their string name.
	var names = params.get("names", [])
	var data: Dictionary = {}

	var mapping := {
		"fps": -1,
		"time/process": Performance.TIME_PROCESS,
		"time/physics_process": Performance.TIME_PHYSICS_PROCESS,
		"memory/static": Performance.MEMORY_STATIC,
		"memory/static_max": Performance.MEMORY_STATIC_MAX,
		"object/count": Performance.OBJECT_COUNT,
		"object/resource_count": Performance.OBJECT_RESOURCE_COUNT,
		"object/node_count": Performance.OBJECT_NODE_COUNT,
		"object/orphan_node_count": Performance.OBJECT_ORPHAN_NODE_COUNT,
		"render/total_objects_in_frame": Performance.RENDER_TOTAL_OBJECTS_IN_FRAME,
		"render/total_primitives_in_frame": Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME,
		"render/total_draw_calls_in_frame": Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME,
	}

	var requested: Array
	if names is Array and not names.is_empty():
		requested = names
	else:
		requested = mapping.keys()

	for raw in requested:
		var key = String(raw)
		if key == "fps":
			data[key] = Engine.get_frames_per_second()
			continue
		if mapping.has(key):
			data[key] = Performance.get_monitor(mapping[key])
			continue
		# Try as custom monitor name
		var custom = Performance.get_custom_monitor(key)
		if custom != null:
			data[key] = custom
		else:
			data[key] = null

	return {"type": "performance_monitors", "data": data, "frame": Engine.get_process_frames()}


# ----------------------------------------------------------------
# Recording / replay
# ----------------------------------------------------------------

func _cmd_start_recording(params: Dictionary) -> Dictionary:
	var rec_name = String(params.get("name", ""))
	if rec_name.is_empty():
		rec_name = "recording_%d" % Time.get_unix_time_from_system()

	if not _active_recording.is_empty():
		return {"type": "error", "message": "Another recording is active: " + _active_recording}

	_recordings[rec_name] = {
		"events": [],
		"started_frame": Engine.get_process_frames(),
		"started_at": Time.get_ticks_msec(),
		"stopped_frame": -1,
	}
	_active_recording = rec_name

	# Hook _input via a synthetic high-level recorder. We can't override _input on the
	# autoload globally for the running scene, so we tap Input.parse_input_event by
	# wrapping the inject_* commands. External device input is captured below in _input.
	return {"type": "recording_started", "name": rec_name, "frame": Engine.get_process_frames()}


func _input(event: InputEvent) -> void:
	if _active_recording.is_empty():
		return
	var rec = _recordings.get(_active_recording, null)
	if rec == null:
		return
	rec["events"].append({
		"frame_offset": Engine.get_process_frames() - int(rec["started_frame"]),
		"t_ms": Time.get_ticks_msec() - int(rec["started_at"]),
		"event": _serialize_input_event(event),
	})


func _serialize_input_event(event: InputEvent) -> Dictionary:
	if event is InputEventKey:
		return {
			"kind": "key",
			"keycode": int(event.keycode),
			"physical_keycode": int(event.physical_keycode),
			"pressed": event.pressed,
			"echo": event.echo,
			"shift": event.shift_pressed,
			"ctrl": event.ctrl_pressed,
			"alt": event.alt_pressed,
		}
	if event is InputEventMouseButton:
		return {
			"kind": "mouse_button",
			"button_index": int(event.button_index),
			"pressed": event.pressed,
			"position": [event.position.x, event.position.y],
			"double_click": event.double_click,
		}
	if event is InputEventMouseMotion:
		return {
			"kind": "mouse_motion",
			"position": [event.position.x, event.position.y],
			"relative": [event.relative.x, event.relative.y],
		}
	if event is InputEventAction:
		return {
			"kind": "action",
			"action": event.action,
			"pressed": event.pressed,
			"strength": event.strength,
		}
	return {"kind": "unknown", "class": event.get_class()}


func _cmd_stop_recording(params: Dictionary) -> Dictionary:
	if _active_recording.is_empty():
		return {"type": "error", "message": "no active recording"}
	var name = _active_recording
	var rec = _recordings.get(name, null)
	if rec == null:
		_active_recording = ""
		return {"type": "error", "message": "recording lost"}
	rec["stopped_frame"] = Engine.get_process_frames()
	rec["duration_ms"] = Time.get_ticks_msec() - int(rec["started_at"])
	_active_recording = ""
	return {
		"type": "recording_stopped",
		"name": name,
		"event_count": rec["events"].size(),
		"duration_ms": rec["duration_ms"],
		"events": rec["events"],
	}


func _cmd_list_recordings(_params: Dictionary) -> Dictionary:
	var out: Array = []
	for n in _recordings.keys():
		var r = _recordings[n]
		out.append({
			"name": n,
			"event_count": r.get("events", []).size(),
			"started_frame": r.get("started_frame", -1),
			"stopped_frame": r.get("stopped_frame", -1),
		})
	return {"type": "recordings", "recordings": out, "active": _active_recording}


func _cmd_replay_recording(params: Dictionary) -> Dictionary:
	var rec_name = String(params.get("name", ""))
	var speed = String(params.get("speed", "frame_locked"))
	var external_events = params.get("events", null)

	var events: Array
	if external_events is Array:
		events = external_events
	elif rec_name.is_empty():
		return {"type": "error", "message": "name or events required"}
	else:
		var rec = _recordings.get(rec_name, null)
		if rec == null:
			return {"type": "error", "message": "recording not found: " + rec_name}
		events = rec.get("events", [])

	if events.is_empty():
		return {"type": "replay_started", "name": rec_name, "events": 0}

	var key = rec_name if not rec_name.is_empty() else "inline_%d" % Time.get_ticks_msec()
	_replays[key] = {
		"events": events,
		"start_frame": Engine.get_process_frames(),
		"start_ms": Time.get_ticks_msec(),
		"index": 0,
		"speed": speed,
	}

	return {
		"type": "replay_started",
		"name": key,
		"events": events.size(),
		"speed": speed,
		"start_frame": Engine.get_process_frames(),
	}


func _advance_replays() -> void:
	if _replays.is_empty():
		return
	var to_remove: Array = []
	for key in _replays.keys():
		var rep = _replays[key]
		var events: Array = rep.get("events", [])
		var idx: int = rep.get("index", 0)
		var start_frame: int = rep.get("start_frame", 0)
		var start_ms: int = rep.get("start_ms", 0)
		var speed: String = rep.get("speed", "frame_locked")

		while idx < events.size():
			var ev_entry = events[idx]
			var due := false
			if speed == "frame_locked":
				var frame_off = int(ev_entry.get("frame_offset", 0))
				due = (Engine.get_process_frames() - start_frame) >= frame_off
			else:
				var t_ms = int(ev_entry.get("t_ms", 0))
				due = (Time.get_ticks_msec() - start_ms) >= t_ms

			if not due:
				break

			_dispatch_replay_event(ev_entry.get("event", {}))
			idx += 1

		rep["index"] = idx
		if idx >= events.size():
			to_remove.append(key)

	for k in to_remove:
		_replays.erase(k)


func _dispatch_replay_event(ev: Dictionary) -> void:
	match ev.get("kind", ""):
		"action":
			var act = InputEventAction.new()
			act.action = String(ev.get("action", ""))
			act.pressed = bool(ev.get("pressed", true))
			act.strength = float(ev.get("strength", 1.0))
			Input.parse_input_event(act)
		"key":
			var k = InputEventKey.new()
			k.keycode = int(ev.get("keycode", 0))
			k.physical_keycode = int(ev.get("physical_keycode", 0))
			k.pressed = bool(ev.get("pressed", true))
			k.shift_pressed = bool(ev.get("shift", false))
			k.ctrl_pressed = bool(ev.get("ctrl", false))
			k.alt_pressed = bool(ev.get("alt", false))
			Input.parse_input_event(k)
		"mouse_button":
			var mb = InputEventMouseButton.new()
			var pos = ev.get("position", [0, 0])
			if pos is Array and pos.size() >= 2:
				mb.position = Vector2(float(pos[0]), float(pos[1]))
				mb.global_position = mb.position
			mb.button_index = int(ev.get("button_index", 1))
			mb.pressed = bool(ev.get("pressed", true))
			mb.double_click = bool(ev.get("double_click", false))
			Input.parse_input_event(mb)
		"mouse_motion":
			var mm = InputEventMouseMotion.new()
			var p = ev.get("position", [0, 0])
			var r = ev.get("relative", [0, 0])
			if p is Array and p.size() >= 2:
				mm.position = Vector2(float(p[0]), float(p[1]))
				mm.global_position = mm.position
			if r is Array and r.size() >= 2:
				mm.relative = Vector2(float(r[0]), float(r[1]))
			Input.parse_input_event(mm)
		_:
			pass


func _cmd_get_engine_state(_params: Dictionary) -> Dictionary:
	return {
		"type": "engine_state",
		"frame": Engine.get_process_frames(),
		"time_ms": Time.get_ticks_msec(),
		"fps": Engine.get_frames_per_second(),
		"time_scale": Engine.time_scale,
		"viewport_size": [get_viewport().get_visible_rect().size.x, get_viewport().get_visible_rect().size.y],
		"paused": get_tree().paused,
	}
