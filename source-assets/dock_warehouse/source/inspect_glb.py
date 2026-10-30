"""Read actual embedded GLB geometry/texture counts without a browser preview."""
from pathlib import Path
from PIL import Image
import hashlib
import io
import json
import struct
import sys


def inspect(path):
    path = Path(path)
    data = path.read_bytes()
    magic, version, total = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2 and total == len(data)
    cursor, document, binary = 12, None, None
    while cursor < len(data):
        length, kind = struct.unpack_from('<II', data, cursor)
        chunk = data[cursor + 8:cursor + 8 + length]
        if kind == 0x4e4f534a:
            document = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = chunk
        cursor += 8 + length
    assert document and binary
    triangles = 0
    mesh_triangles = []
    for mesh in document.get('meshes', []):
        mesh_count = 0
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4, 'Nontriangle primitive'
            index = primitive.get('indices', primitive['attributes']['POSITION'])
            mesh_count += document['accessors'][index]['count'] // 3
        mesh_triangles.append(mesh_count)
        triangles += mesh_count
    stored_triangles = triangles
    # glTF may share a mesh across multiple nodes. Report actual default-scene
    # instances as well as stored triangle payload, so fresh import agrees.
    nodes = document.get('nodes', [])
    def count_node(index):
        node = nodes[index]
        return (mesh_triangles[node['mesh']] if 'mesh' in node else 0) + sum(count_node(i) for i in node.get('children', []))
    if document.get('scenes'):
        scene = document['scenes'][document.get('scene', 0)]
        triangles = sum(count_node(i) for i in scene.get('nodes', []))
    textures = []
    for img in document.get('images', []):
        assert 'bufferView' in img, 'External image dependency'
        view = document['bufferViews'][img['bufferView']]
        offset = view.get('byteOffset', 0)
        image = Image.open(io.BytesIO(binary[offset:offset + view['byteLength']]))
        textures.append({'name': img.get('name'), 'dimensions': list(image.size),
                         'bytes': view['byteLength'], 'format': image.format})
    return {'file': str(path.resolve()), 'bytes': len(data), 'triangles': triangles,
            'stored_triangles': stored_triangles,
            'textures': textures, 'materials': len(document.get('materials', [])),
            'meshes': len(document.get('meshes', [])),
            'embedded_buffers': all('uri' not in b for b in document.get('buffers', [])),
            'sha256': hashlib.sha256(data).hexdigest()}


if __name__ == '__main__':
    for path in sys.argv[1:]:
        print(json.dumps(inspect(path), ensure_ascii=False, indent=2))
