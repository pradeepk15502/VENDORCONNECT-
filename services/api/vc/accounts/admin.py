from django.contrib import admin

from .models import Address, OtpChallenge, User, UserRole


class UserRoleInline(admin.TabularInline):
    model = UserRole
    fk_name = "user"
    extra = 0
    readonly_fields = ["granted_at"]


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ["phone", "name", "is_active", "date_joined"]
    search_fields = ["phone", "name"]
    list_filter = ["is_active", "is_staff"]
    inlines = [UserRoleInline]
    exclude = ["password"]
    readonly_fields = ["last_login", "date_joined", "phone_verified_at"]


@admin.register(OtpChallenge)
class OtpAdmin(admin.ModelAdmin):
    list_display = ["phone", "purpose", "created_at", "attempts", "consumed_at"]
    readonly_fields = [f.name for f in OtpChallenge._meta.fields]
    exclude = ["code_hash"]


admin.site.register(Address)
