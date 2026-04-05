"""Generate 2x2 grid image comparing telescope mirror types near focus."""
import math
from PIL import Image, ImageDraw, ImageFont

PANEL = 600
FULL = 1200

mirror_types = ['parabolic', 'spherical', 'elliptical', 'hyperbolic']
labels = ['Parabolic', 'Spherical', 'Elliptical', 'Hyperbolic']
positions = [(0, 0), (PANEL, 0), (0, PANEL), (PANEL, PANEL)]

tube_length = 360
tube_width = tube_length / 2
half_w = tube_width / 2
Rc = 135

conic_k = {'spherical': 0, 'parabolic': -1, 'elliptical': -0.5, 'hyperbolic': -2}

W, H = 600, 600
base_x, base_y = W / 2, H - 80

ray_angle = 20 * math.pi / 180
telescope_angle = -ray_angle
cos_a = math.cos(telescope_angle)
sin_a = math.sin(telescope_angle)

in_dir_wx = -math.sin(ray_angle)
in_dir_wy = math.cos(ray_angle)
perp_wx = in_dir_wy
perp_wy = -in_dir_wx

default_offsets = [-0.8, -0.5, -0.2, 0.1, 0.4, 0.7, -0.65, -0.35]

ax_t = -sin_a
ay_t = -cos_a
px_t = cos_a
py_t = -sin_a

dir_u = in_dir_wx * ax_t + in_dir_wy * ay_t
dir_v = in_dir_wx * px_t + in_dir_wy * py_t

def mirror_sag(x, mtype):
    r = abs(x)
    K = conic_k[mtype]
    if abs(1 + K) < 1e-10:
        return (r * r) / (2 * Rc)
    disc = 1 - (1 + K) * r * r / (Rc * Rc)
    if disc < 0:
        return (r * r) / (2 * Rc)
    return (r * r) / (Rc * (1 + math.sqrt(disc)))

focal_length = Rc / 2

def to_world(u, v):
    return (base_x + u * ax_t + v * px_t, base_y + u * ay_t + v * py_t)

focus_world = to_world(focal_length, 0)
view_zoom = 4.5
base_pan_x = -(focus_world[0] - W / 2) * view_zoom
base_pan_y = -(focus_world[1] - H / 2) * view_zoom

bg_color = (26, 26, 46)

try:
    font = ImageFont.truetype("arial.ttf", 52)
except:
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    except:
        font = ImageFont.load_default()


def make_panel(mtype, label):
    """Render one panel (PANEL x PANEL) and return as RGBA Image."""
    panel = Image.new('RGBA', (PANEL, PANEL), bg_color + (255,))
    draw = ImageDraw.Draw(panel)

    def world_to_screen(wx, wy):
        return (
            (wx - W / 2) * view_zoom + PANEL / 2 + base_pan_x,
            (wy - H / 2) * view_zoom + PANEL / 2 + base_pan_y,
        )

    def to_screen(u, v):
        w = to_world(u, v)
        return world_to_screen(w[0], w[1])

    # Tube walls (subtle)
    for sign in (-1, 1):
        p1 = to_screen(tube_length, sign * half_w)
        p2 = to_screen(0, sign * half_w)
        draw.line([p1, p2], fill=(136, 136, 136, 80), width=2)

    # Optical axis (dashed)
    p1 = to_screen(-20, 0)
    p2 = to_screen(tube_length + 40, 0)
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length > 0:
        ux, uy = dx / length, dy / length
        pos = 0.0
        while pos < length:
            end = min(pos + 8, length)
            draw.line([
                (p1[0] + ux * pos, p1[1] + uy * pos),
                (p1[0] + ux * end, p1[1] + uy * end),
            ], fill=(255, 255, 255, 38), width=1)
            pos = end + 8

    # Trace and draw reflected rays
    for offset in default_offsets:
        d_world = offset * half_w
        ref_wx = base_x + d_world * perp_wx
        ref_wy = base_y + d_world * perp_wy
        rdx = ref_wx - base_x
        rdy = ref_wy - base_y
        u_ref = rdx * ax_t + rdy * ay_t
        v_ref = rdx * px_t + rdy * py_t

        enters_aperture = False
        v_ap = 0.0

        if abs(dir_u) > 1e-4:
            t1u = -u_ref / dir_u
            t2u = (tube_length - u_ref) / dir_u
            t_enter_u, t_exit_u = min(t1u, t2u), max(t1u, t2u)

            t_enter_v, t_exit_v = -math.inf, math.inf
            if abs(dir_v) > 1e-4:
                t1v = (-half_w - v_ref) / dir_v
                t2v = (half_w - v_ref) / dir_v
                t_enter_v, t_exit_v = min(t1v, t2v), max(t1v, t2v)
            elif v_ref < -half_w or v_ref > half_w:
                t_enter_v, t_exit_v = math.inf, -math.inf

            t_entry = max(t_enter_u, t_enter_v)
            t_exit_box = min(t_exit_u, t_exit_v)
            if t_entry < t_exit_box:
                if abs(u_ref + dir_u * t_entry - tube_length) < 1:
                    enters_aperture = True
                    v_ap = v_ref + dir_v * t_entry

        if not enters_aperture:
            continue

        # Find mirror hit via bisection
        t_low, t_high = 0.0, abs(tube_length / dir_u) * 3
        for _ in range(50):
            t_mid = (t_low + t_high) / 2
            if tube_length + dir_u * t_mid > mirror_sag(v_ap + dir_v * t_mid, mtype):
                t_low = t_mid
            else:
                t_high = t_mid
        t_mirror = (t_low + t_high) / 2

        t_wall = math.inf
        if abs(dir_v) > 1e-4:
            for boundary in (-half_w, half_w):
                tw = (boundary - v_ap) / dir_v
                if tw > 0.01:
                    t_wall = min(t_wall, tw)

        if t_wall < t_mirror:
            continue  # hits wall before mirror

        v_hit = v_ap + dir_v * t_mirror
        u_hit = tube_length + dir_u * t_mirror
        if abs(v_hit) > half_w:
            continue

        hit_s = to_screen(u_hit, v_hit)

        # Reflection
        dv = 0.05
        dsagdv = (mirror_sag(v_hit + dv, mtype) - mirror_sag(v_hit - dv, mtype)) / (2 * dv)
        n_len = math.sqrt(1 + dsagdv ** 2)
        nu, nv = 1 / n_len, -dsagdv / n_len
        d_len = math.sqrt(dir_u ** 2 + dir_v ** 2)
        du_n, dv_n = dir_u / d_len, dir_v / d_len
        dot = du_n * nu + dv_n * nv
        ru = du_n - 2 * dot * nu
        rv = dv_n - 2 * dot * nv

        s_end = tube_length * 2
        if abs(rv) > 1e-4:
            for boundary in (-half_w, half_w):
                sw = (boundary - v_hit) / rv
                if sw > 0.1:
                    s_end = min(s_end, sw)
        if ru > 1e-4:
            st = (tube_length - u_hit) / ru
            if st > 0.1:
                s_end = min(s_end, st)

        end_s = to_screen(u_hit + ru * s_end, v_hit + rv * s_end)

        draw.line([hit_s, end_s], fill=(231, 76, 60, 204), width=3)

        # Mirror hit dot
        r_dot = 4
        draw.ellipse(
            [hit_s[0] - r_dot, hit_s[1] - r_dot, hit_s[0] + r_dot, hit_s[1] + r_dot],
            fill=(231, 76, 60, 230),
        )

    # Focus crosshair
    fs = to_screen(focal_length, 0)
    cs = 8
    draw.line([(fs[0] - cs, fs[1]), (fs[0] + cs, fs[1])], fill=(255, 255, 255, 64), width=1)
    draw.line([(fs[0], fs[1] - cs), (fs[0], fs[1] + cs)], fill=(255, 255, 255, 64), width=1)

    # Label (panel-local coordinates)
    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    lx = PANEL / 2 - tw / 2
    ly = PANEL - 65
    draw.text((lx + 1, ly + 1), label, fill=(0, 0, 0, 200), font=font)
    draw.text((lx, ly), label, fill=(255, 255, 255, 255), font=font)

    return panel


# Build final image
img = Image.new('RGBA', (FULL, FULL), bg_color + (255,))

for i in range(4):
    panel = make_panel(mirror_types[i], labels[i])
    img.paste(panel, positions[i])

# Grid dividers
final_draw = ImageDraw.Draw(img)
final_draw.line([(PANEL, 0), (PANEL, FULL)], fill=(255, 255, 255, 51), width=2)
final_draw.line([(0, PANEL), (FULL, PANEL)], fill=(255, 255, 255, 51), width=2)

# Save as RGB PNG
img_rgb = Image.new('RGB', (FULL, FULL), bg_color)
img_rgb.paste(img, mask=img.split()[3])

out_path = r"C:\Users\Mark Eichenlaub\github-aops\539_Middle_School_Physics_1\Light\telescope_mirror_comparison.png"
img_rgb.save(out_path, 'PNG')
print(f"Saved to {out_path}")
