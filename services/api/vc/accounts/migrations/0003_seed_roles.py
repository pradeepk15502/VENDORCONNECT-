from django.db import migrations

ROLES = {
    "customer": "Search, follow, chat, order",
    "vendor": "Manage a shop, listings, stock, orders",
    "admin": "Full platform administration",
    "moderator": "Moderate posts, reviews and reports",
    "support": "Help users, view orders and disputes",
}


def seed(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    for code, desc in ROLES.items():
        Role.objects.update_or_create(code=code, defaults={"description": desc})


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
