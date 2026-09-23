from django.contrib import admin

from .models import Category, Product, ProductAlias, ProductVariety, VendorProduct


class AliasInline(admin.TabularInline):
    model = ProductAlias
    extra = 1


class VarietyInline(admin.TabularInline):
    model = ProductVariety
    extra = 0


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "default_unit", "is_active"]
    search_fields = ["name", "slug", "aliases__text"]
    list_filter = ["category"]
    inlines = [VarietyInline, AliasInline]


admin.site.register(Category)
admin.site.register(VendorProduct)
