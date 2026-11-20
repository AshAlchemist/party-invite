# Рендер хрустального бокала с именинницей внутри (Blender 5, Cycles, CPU).
# Запуск: blender -b --factory-startup -P tools/glass.py -- --girl assets-src/girl.png --out render/glass.png \
#           --w 700 --h 1200 --samples 48 [--no-girl] [--only-girl]
# Единица сцены — рост фигуры на фото (H = 1).
import bpy, sys, math

class np:
    @staticmethod
    def linspace(a, b, n, endpoint=True):
        if n == 1: return [a]
        d = (b - a) / ((n - 1) if endpoint else n)
        return [a + d * i for i in range(n)]
def clip01(x):
    return max(0.0, min(1.0, x))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None, cast=str):
    if name in argv:
        i = argv.index(name)
        return cast(argv[i + 1])
    return default
def flag(name):
    return name in argv

GIRL = arg('--girl')
OUT = arg('--out', '/tmp/glass.png')
W = arg('--w', 700, int)
H = arg('--h', 1200, int)
SAMPLES = arg('--samples', 48, int)
NO_GIRL = flag('--no-girl')
RIBS = arg('--ribs', 30, int)
RIB_AMP = arg('--rib-amp', 0.028, float)
RIB_TOP = arg('--rib-top', 0.62, float)      # доля высоты чаши, до которой идут грани
PITCH = arg('--pitch', 8.0, float)           # наклон камеры вниз, градусы
RIM_AT = arg('--rim-at', 0.56, float)        # доля роста фигуры (от макушки), на которой проходит край бокала
GIRL_DX = arg('--girl-dx', 0.03, float)      # сдвиг фигуры вправо
GIRL_ROT = arg('--girl-rot', 0.0, float)     # наклон фигуры, градусы

# ---------- геометрия бокала ----------
R = arg('--R', 0.37, float)          # радиус чаши
D = arg('--D', 0.50, float)          # глубина чаши
EB = arg('--EB', 0.31, float)         # высота эллиптического дна чаши
Z0 = arg('--Z0', 0.80, float)         # низ чаши (верх ножки)
RS = 0.019        # радиус ножки
RF = arg('--RF', 0.25, float)         # радиус основания

def outer_profile():
    pts = []
    # основание
    pts += [(0.0, 0.0), (RF * 0.6, 0.0), (RF - 0.004, 0.0), (RF, 0.004), (RF - 0.003, 0.009)]
    for t in np.linspace(0, 1, 26)[1:]:
        r = RF - 0.003 - (RF - 0.003 - RS * 1.25) * (1 - (1 - t) ** 2.6)
        z = 0.009 + 0.075 * t ** 2.2
        pts.append((r, z))
    # ножка с узелком
    zs0, zs1 = 0.084, Z0 - 0.03
    for t in np.linspace(0, 1, 60)[1:]:
        z = zs0 + (zs1 - zs0) * t
        r = RS * (1.25 - 0.25 * math.sin(math.pi * min(1, t * 1.4)) ** 0.5 * 0.6)
        r += 0.012 * math.exp(-((t - 0.90) / 0.035) ** 2)      # узелок под чашей
        r += 0.004 * math.exp(-((t - 0.80) / 0.02) ** 2)
        pts.append((r, z))
    # чаша: эллиптическое дно + стенка
    phi0 = math.asin(min(1, RS * 1.6 / R))
    for phi in np.linspace(phi0, math.pi / 2, 70):
        r = R * math.sin(phi)
        z = Z0 + EB * (1 - math.cos(phi))
        pts.append((r, z))
    for t in np.linspace(0, 1, 40)[1:]:
        z = Z0 + EB + (D - EB) * t
        r = R * (1 - 0.035 * t ** 1.6)                         # лёгкий «тюльпан»
        pts.append((r, z))
    return pts

def inner_profile(outer_bowl_top):
    # от края вниз до дна
    rt, zt = outer_bowl_top
    pts = []
    th_rim, th_wall, th_bot = 0.004, 0.011, 0.05
    # кромка
    for a in np.linspace(0, math.pi, 9)[1:]:
        pts.append((rt - th_rim / 2 + th_rim / 2 * math.cos(a), zt + th_rim / 2 * math.sin(a)))
    for t in np.linspace(0, 1, 40)[1:]:
        z = zt - (D - EB) * t
        r_out = R * (1 - 0.035 * (1 - t) ** 1.6)
        th = th_rim + (th_wall - th_rim) * t
        pts.append((r_out - th, z))
    Ri, Ei = R - th_wall, EB - th_bot
    for phi in np.linspace(math.pi / 2, 0, 70)[1:]:
        pts.append((Ri * math.sin(phi), Z0 + th_bot + Ei * (1 - math.cos(phi))))
    return pts

def build_glass():
    outer = outer_profile()
    n_outer = len(outer)
    inner = inner_profile(outer[-1])
    prof = outer + inner
    M = RIBS * 16
    th = np.linspace(0, 2 * math.pi, M, endpoint=False)
    verts, faces = [], []
    ring_idx = []
    zb0, zb1 = Z0, Z0 + D
    for k, (r, z) in enumerate(prof):
        if r < 1e-6:
            ring_idx.append([len(verts)])
            verts.append((0, 0, z))
            continue
        rr = [r] * M
        if k < n_outer and z > zb0 - 0.03:
            u = (z - zb0) / (zb1 - zb0)                        # 0 дно чаши … 1 край
            env = clip01((RIB_TOP - u) / 0.10)                 # грани гаснут к RIB_TOP
            env = env * env * (3 - 2 * env)
            env *= clip01((u + 0.05) / 0.08)
            rr = [r * (1 + RIB_AMP * env * (abs(math.cos(t * RIBS / 2)) ** 1.3 - 0.5)) for t in th]
        base = len(verts)
        for j in range(M):
            verts.append((rr[j] * math.cos(th[j]), rr[j] * math.sin(th[j]), z))
        ring_idx.append(list(range(base, base + M)))
    for k in range(len(prof) - 1):
        a, b = ring_idx[k], ring_idx[k + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(M):
            j2 = (j + 1) % M
            if len(a) == 1:
                faces.append((a[0], b[j2], b[j]))
            elif len(b) == 1:
                faces.append((a[j], a[j2], b[0]))
            else:
                faces.append((a[j], a[j2], b[j2], b[j]))
    me = bpy.data.meshes.new('glass')
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new('glass', me)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat = bpy.data.materials.new('crystal')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    g = nt.nodes.new('ShaderNodeBsdfGlass')
    g.inputs['IOR'].default_value = 1.56
    g.inputs['Roughness'].default_value = 0.0
    g.inputs['Color'].default_value = (1, 1, 1, 1)
    nt.links.new(g.outputs[0], out.inputs['Surface'])
    ob.data.materials.append(mat)
    return ob

def emit_mat(name, strength, color=(1, 1, 1)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*color, 1)
    e.inputs['Strength'].default_value = strength
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    return mat

def softbox(name, loc, size, strength, look_at=(0, 0, 1.0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0], size[1], 1)
    d = [look_at[i] - loc[i] for i in range(3)]
    # ось -Z плоскости смотрит на цель
    import mathutils
    ob.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
    ob.data.materials.append(emit_mat(name, strength))
    ob.visible_camera = False
    ob.visible_shadow = False
    return ob

def build_girl():
    img = bpy.data.images.load(GIRL)
    iw, ih = img.size
    asp = iw / ih
    bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.object
    ob.name = 'girl'
    ob.scale = (asp, 1, 1)
    ob.rotation_euler = (math.radians(90), math.radians(GIRL_ROT), 0)
    rim_z = Z0 + D
    ob.location = (GIRL_DX, 0.0, rim_z + (RIM_AT - 0.5))
    mat = bpy.data.materials.new('girl')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Cubic'
    tex.extension = 'CLIP'
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    ob.data.materials.append(mat)
    ob.visible_shadow = False
    return ob

# ---------- сцена ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 32
sc.cycles.transmission_bounces = 24
sc.cycles.glossy_bounces = 16
sc.cycles.transparent_max_bounces = 16
sc.cycles.sample_clamp_indirect = 4.0
sc.cycles.sample_clamp_direct = 0.0
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.cycles.film_transparent_glass = True
sc.cycles.film_transparent_roughness = 0.1
sc.render.film_transparent = True
sc.render.resolution_x = W
sc.render.resolution_y = H
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.color_depth = '16'
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.render.threads_mode = 'AUTO'

world = bpy.data.worlds.new('w')
world.use_nodes = True
WG = arg('--world', 0.012, float)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (WG, WG, WG * 1.03, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sc.world = world

build_glass()
if not NO_GIRL and GIRL:
    build_girl()


def build_olive():
    import mathutils
    rim_z = Z0 + D
    # шпажка: от дна чаши справа — через левый край наружу
    p0 = mathutils.Vector((0.13, 0.12, Z0 + 0.10))
    p1 = mathutils.Vector((-R - 0.20, 0.10, rim_z + 0.27))
    d = (p1 - p0)
    L = d.length
    mid = (p0 + p1) / 2
    q = d.to_track_quat('Z', 'Y')
    bpy.ops.mesh.primitive_cylinder_add(radius=0.0055, depth=L, vertices=24, location=mid)
    pick = bpy.context.object
    pick.rotation_euler = q.to_euler()
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new('silver')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.86, 0.86, 0.88, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.12
    pick.data.materials.append(m)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.016, location=p1 + d.normalized() * 0.012, segments=24, ring_count=12)
    knob = bpy.context.object
    bpy.ops.object.shade_smooth()
    knob.data.materials.append(m)
    om = bpy.data.materials.new('olive')
    om.use_nodes = True
    b = om.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.20, 0.215, 0.075, 1)
    b.inputs['Roughness'].default_value = 0.22
    for name in ('Coat Weight',):
        if name in b.inputs:
            b.inputs[name].default_value = 0.6
    for name in ('Subsurface Weight',):
        if name in b.inputs:
            b.inputs[name].default_value = 0.15
    for k, off in enumerate((0.085, 0.215)):
        c = p1 - d.normalized() * off
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=c, segments=48, ring_count=24)
        o = bpy.context.object
        o.scale = (0.094, 0.094, 0.122)
        o.rotation_euler = q.to_euler()
        bpy.ops.object.shade_smooth()
        o.data.materials.append(om)

if not flag('--no-olive'):
    build_olive()

# свет: две полосы-софтбокса, верхний, «вспышка» у камеры
K = arg('--light', 1.0, float)
softbox('strip_l', (-1.9, -1.3, 1.1), (0.16, 2.6), 22.0 * K)
softbox('strip_r', (2.1, -0.9, 1.1), (0.45, 2.6), 7.0 * K)
softbox('top', (0.2, -0.6, 3.2), (1.2, 0.8), 6.0 * K)
softbox('flash', (0.3, -5.2, 1.9), (0.4, 0.4), 60.0 * K, look_at=(0, 0, 1.0))
softbox('kick_back', (-1.4, 1.8, 1.6), (0.2, 1.4), 12.0 * K)

# камера: ортографическая, чуть сверху
total_h = Z0 + D + RIM_AT + 0.06
cam_d = bpy.data.cameras.new('cam')
cam_d.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_d)
bpy.context.collection.objects.link(cam)
p = math.radians(PITCH)
cz = total_h / 2 - 0.02
dist = 8.0
cam.location = (0.0, -dist * math.cos(p), cz + dist * math.sin(p))
cam.rotation_euler = (math.radians(90) - p, 0, 0)
need_h = total_h * math.cos(p) + 0.10
ext_l = R + (0.0 if flag('--no-olive') else 0.30) + 0.05
ext_r = R + 0.05
need_w = ext_l + ext_r
cam.location.x = (ext_r - ext_l) / 2
if W >= H:
    cam_d.ortho_scale = max(need_w, need_h * W / H)
else:
    cam_d.ortho_scale = max(need_h, need_w * H / W)
print('META2 need_w=%.4f need_h=%.4f cam_x=%.4f' % (need_w, need_h, cam.location.x))
cam_d.clip_end = 50
sc.camera = cam

sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
# метаданные для вёрстки
print('META total_h=%.4f ortho_scale=%.4f rim_z=%.4f pitch=%.2f R=%.3f W=%d H=%d' % (total_h, cam_d.ortho_scale, Z0 + D, PITCH, R, W, H))
