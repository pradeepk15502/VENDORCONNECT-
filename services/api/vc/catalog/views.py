from rest_framework import generics, serializers
from rest_framework.permissions import AllowAny

from .models import Category


class CategorySerializer(serializers.ModelSerializer):
    parent = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = Category
        fields = ["slug", "name", "names_i18n", "icon", "parent", "sort_order"]


class CategoryListView(generics.ListAPIView):
    permission_classes = [AllowAny]
    serializer_class = CategorySerializer
    pagination_class = None
    queryset = Category.objects.filter(is_active=True).select_related("parent")
