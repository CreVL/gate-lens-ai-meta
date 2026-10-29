class DisplayAction {
  const DisplayAction(this.id, this.label);
  final String id;
  final String label;
  Map<String, Object> toMap() => {'id': id, 'label': label};
}

/// Presentation data only. This object cannot authorize physical access.
class DisplayCard {
  const DisplayCard({
    required this.revision,
    required this.title,
    required this.subtitle,
    required this.actions,
    this.status = 'demo',
    this.imageBase64,
  });
  final int revision;
  final String title;
  final String subtitle;
  final String status;
  final String? imageBase64;
  final List<DisplayAction> actions;
  Map<String, Object> toMap() => {
    'revision': revision,
    'title': title,
    'subtitle': subtitle,
    'status': status,
    'imageBase64': ?imageBase64,
    'actions': actions.map((action) => action.toMap()).toList(),
  };
}
