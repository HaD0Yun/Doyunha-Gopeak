extends CanvasLayer

@onready var start_button = $StartButton
@onready var label = $Label
var started = false

func _ready():
	start_button.pressed.connect(_on_start_pressed)

func _on_start_pressed():
	started = true
	TestFlags.started = true
	label.text = "Score: 1"