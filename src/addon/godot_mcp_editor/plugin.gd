@tool
extends EditorPlugin

const MCPEditorClientScript = preload("mcp_client.gd")
const MCPToolExecutorScript = preload("tool_executor.gd")

var _mcp_client: Node
var _tool_executor: Node
var _status_label: Label


func _enter_tree() -> void:
	_mcp_client = MCPEditorClientScript.new()
	_mcp_client.name = "MCPEditorClient"
	add_child(_mcp_client)

	_tool_executor = MCPToolExecutorScript.new()
	_tool_executor.name = "MCPToolExecutor"
	add_child(_tool_executor)
	_tool_executor.set_editor_plugin(self)

	_mcp_client.connected.connect(_on_connected)
	_mcp_client.disconnected.connect(_on_disconnected)
	_mcp_client.tool_requested.connect(_on_tool_requested)

	_setup_status_indicator()
	_mcp_client.connect_to_server()


func _exit_tree() -> void:
	if _mcp_client:
		if _mcp_client.connected.is_connected(_on_connected):
			_mcp_client.connected.disconnect(_on_connected)
		if _mcp_client.disconnected.is_connected(_on_disconnected):
			_mcp_client.disconnected.disconnect(_on_disconnected)
		if _mcp_client.tool_requested.is_connected(_on_tool_requested):
			_mcp_client.tool_requested.disconnect(_on_tool_requested)
		_mcp_client.disconnect_from_server()
		_mcp_client.queue_free()
		_mcp_client = null

	if _tool_executor:
		_tool_executor.queue_free()
		_tool_executor = null

	if _status_label:
		remove_control_from_container(CONTAINER_TOOLBAR, _status_label)
		_status_label.queue_free()
		_status_label = null


func _setup_status_indicator() -> void:
	_status_label = Label.new()
	_status_label.text = "MCP: Connecting..."
	_status_label.add_theme_color_override("font_color", Color.YELLOW)
	_status_label.add_theme_font_size_override("font_size", 12)
	add_control_to_container(CONTAINER_TOOLBAR, _status_label)


func _on_connected() -> void:
	if _status_label:
		_status_label.text = "MCP: Connected"
		_status_label.add_theme_color_override("font_color", Color.GREEN)


func _on_disconnected() -> void:
	if _status_label:
		_status_label.text = "MCP: Disconnected"
		_status_label.add_theme_color_override("font_color", Color.RED)


func _on_tool_requested(request_id: String, tool_name: String, args: Dictionary) -> void:
	if _tool_executor == null or _mcp_client == null:
		return

	var result: Dictionary = _tool_executor.execute_tool(tool_name, args)
	var success: bool = result.get("ok", false)

	if success:
		var payload := result.duplicate(true)
		_mcp_client.send_tool_result(request_id, true, payload, "")
	else:
		_mcp_client.send_tool_result(request_id, false, null, str(result.get("error", "Unknown error")))
