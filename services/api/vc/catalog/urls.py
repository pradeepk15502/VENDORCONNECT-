from django.urls import path

from . import views

urlpatterns = [
    path("categories", views.CategoryListView.as_view(), name="categories"),
    path("search", views.SearchView.as_view(), name="search"),
    path("listings/<uuid:pk>", views.ListingDetailView.as_view(), name="listing-detail"),
    path("vendor-products", views.VendorProductCollectionView.as_view(), name="vendor-products"),
    path("vendor-products/<uuid:pk>", views.VendorProductDetailView.as_view(), name="vendor-product-detail"),
    path("inventory", views.InventoryView.as_view(), name="inventory"),
    path("prices", views.PriceView.as_view(), name="prices"),
    # Admin (Phase 11, ARCHITECTURE D32)
    path("admin/products", views.AdminListingListView.as_view(), name="admin-listing-list"),
    path("admin/categories", views.AdminCategoryListView.as_view(), name="admin-category-list"),
]
