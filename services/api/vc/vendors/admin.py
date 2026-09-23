from django.contrib import admin

from .models import DeliverySettings, Vendor, VendorHours, VendorLocation, VendorProfile


class LocationInline(admin.StackedInline):
    model = VendorLocation


class DeliveryInline(admin.StackedInline):
    model = DeliverySettings


@admin.register(Vendor)
class VendorAdmin(admin.ModelAdmin):
    list_display = ["handle", "shop_name", "status", "verification_status", "is_open", "created_at"]
    search_fields = ["handle", "shop_name"]
    list_filter = ["status", "verification_status", "is_open"]
    readonly_fields = ["handle", "rating_avg", "rating_count", "follower_count"]
    inlines = [LocationInline, DeliveryInline]


admin.site.register(VendorProfile)
admin.site.register(VendorHours)
