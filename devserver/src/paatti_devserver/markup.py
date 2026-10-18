"""A small element tree for the blocks of Ilta-Pulu.

The markup noise edits structure: it adds classes and attributes, wraps elements and inserts siblings. A tree lets
one function apply a noise kind to any block. The page skeleton is a Jinja template; the blocks are trees.
"""

from dataclasses import dataclass, field
from html import escape

VOID = frozenset({"img", "br", "hr", "source", "meta", "link", "input"})


@dataclass
class Comment:
    text: str


@dataclass
class El:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def add_class(self, *names: str) -> "El":
        self.attrs["class"] = " ".join(filter(None, [self.attrs.get("class", ""), *names])).strip()
        return self

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, El):
                yield from child.walk()


def el(tag: str, attrs: dict | None = None, *children) -> El:
    return El(tag, dict(attrs or {}), [child for child in children if child is not None])


def render(node) -> str:
    if isinstance(node, str):
        return escape(node, quote=False)
    if isinstance(node, Comment):
        return f"<!-- {node.text.replace('--', '- -')} -->"
    attrs = "".join(
        f" {name}" if value is True else f' {name}="{escape(str(value))}"'
        for name, value in node.attrs.items() if value is not None and value is not False
    )
    if node.tag in VOID:
        return f"<{node.tag}{attrs}>"
    return f"<{node.tag}{attrs}>{''.join(render(child) for child in node.children)}</{node.tag}>"
